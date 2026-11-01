import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import { PrismaService } from '../../../infrastructure/prisma'
import { AuditService } from '../../audit/services/audit.service'
import { addDays, nextBillingTransition } from '../billing-rules'

// The daily pass over club billing: an ended trial or an unpaid period goes
// PAST_DUE (or stays ACTIVE through a platform free period), PAST_DUE turns
// SUSPENDED after PLATFORM_GRACE_DAYS, and a club still SUSPENDED
// PLATFORM_ARCHIVE_AFTER_DAYS later is archived. The rules live in
// nextBillingTransition; this applies them, each row guarded on the status
// it was read with so a console action that lands mid-pass wins.
@Injectable()
export class BillingLifecycleService {
    private readonly logger = new Logger(BillingLifecycleService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async run(
        now: Date = new Date(),
    ): Promise<{ pastDue: number; suspended: number; archived: number }> {
        if (!environment.billing.enabled) return { pastDue: 0, suspended: 0, archived: 0 }

        const candidates = await this.prisma.workspaceBilling.findMany({
            where: {
                OR: [
                    { status: 'TRIAL', trialEndsAt: { lte: now } },
                    { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
                    { status: 'PAST_DUE' },
                ],
            },
            select: {
                id: true,
                workspaceId: true,
                status: true,
                trialEndsAt: true,
                currentPeriodEnd: true,
                pastDueSince: true,
                freeUntil: true,
            },
        })

        let pastDue = 0
        let suspended = 0
        for (const row of candidates) {
            const next = nextBillingTransition(
                row,
                now,
                environment.billing.graceDays,
            )
            if (!next) continue

            const { count } = await this.prisma.workspaceBilling.updateMany({
                where: { id: row.id, status: row.status },
                data:
                    next.status === 'PAST_DUE'
                        ? { status: 'PAST_DUE', pastDueSince: next.pastDueSince }
                        : next.status === 'ACTIVE'
                          ? { status: 'ACTIVE', currentPeriodEnd: next.currentPeriodEnd }
                          : { status: 'SUSPENDED', suspendedAt: now, archivedAt: null },
            })
            if (count === 0) continue

            if (next.status === 'PAST_DUE') pastDue += 1
            else if (next.status === 'SUSPENDED') suspended += 1

            await this.audit.record({
                action: 'workspace.billingExpire',
                targetType: 'workspace',
                targetId: row.workspaceId,
                workspaceId: row.workspaceId,
                actorId: null,
                metadata: { from: row.status, to: next.status },
            })
        }

        const archived = await this.archive(now)

        if (pastDue > 0 || suspended > 0 || archived > 0) {
            this.logger.log(
                `billing lifecycle: ${pastDue} past due, ${suspended} suspended, ${archived} archived`,
            )
        }
        return { pastDue, suspended, archived }
    }

    // A club suspended PLATFORM_ARCHIVE_AFTER_DAYS ago and still unpaid is
    // archived: hidden from its members' club lists and the public listing
    // (isListed off). Nothing is deleted — payments, the audit log and the
    // club's data stay; paying (or the console) brings it back. A row
    // suspended before suspendedAt existed counts from its last change.
    private async archive(now: Date): Promise<number> {
        const before = addDays(now, -environment.billing.archiveAfterDays)
        const due = await this.prisma.workspaceBilling.findMany({
            where: {
                status: 'SUSPENDED',
                archivedAt: null,
                OR: [
                    { suspendedAt: { lte: before } },
                    { suspendedAt: null, updatedAt: { lte: before } },
                ],
            },
            select: { id: true, workspaceId: true },
        })
        let archived = 0
        for (const row of due) {
            const { count } = await this.prisma.workspaceBilling.updateMany({
                where: { id: row.id, status: 'SUSPENDED', archivedAt: null },
                data: { archivedAt: now },
            })
            if (count === 0) continue
            archived += 1
            await this.prisma.workspace.update({
                where: { id: row.workspaceId },
                data: { isListed: false },
            })
            await this.audit.record({
                action: 'workspace.billingArchive',
                targetType: 'workspace',
                targetId: row.workspaceId,
                workspaceId: row.workspaceId,
                actorId: null,
                metadata: { archiveAfterDays: environment.billing.archiveAfterDays },
            })
        }
        return archived
    }
}
