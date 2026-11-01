import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import { PrismaService } from '../../../infrastructure/prisma'
import { AuditService } from '../../audit/services/audit.service'
import { nextBillingTransition } from '../billing-rules'

// The daily pass over club billing: an ended trial or an unpaid period goes
// PAST_DUE (or stays ACTIVE through a platform free period), and PAST_DUE
// turns SUSPENDED after PLATFORM_GRACE_DAYS. The rules live in
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
    ): Promise<{ pastDue: number; suspended: number }> {
        if (!environment.billing.enabled) return { pastDue: 0, suspended: 0 }

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
                          : { status: 'SUSPENDED' },
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

        if (pastDue > 0 || suspended > 0) {
            this.logger.log(
                `billing lifecycle: ${pastDue} past due, ${suspended} suspended`,
            )
        }
        return { pastDue, suspended }
    }
}
