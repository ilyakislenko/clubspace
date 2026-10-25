import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/prisma'
import { COACHING_ROLES } from '../../shared/decorators/roles.decorator'
import { pluralRu } from '../../shared/utils/plural-ru'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'
import { coachDigestCounts, retentionDigestSlot } from './digest-slot'
import { loadWorkspaceRisk } from './load-workspace-risk'

// Monday-morning «Кому позвонить на этой неделе» push to every coach with
// at-risk students in their groups. Run from the scheduler tick.
@Injectable()
export class RetentionDigestService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async run(now: Date = new Date()): Promise<{
        workspaces: number
        sent: number
    }> {
        const workspaces = await this.prisma.workspace.findMany({
            where: { isActive: true },
            select: { id: true, name: true, timezone: true, ownerId: true },
        })

        let ran = 0
        let sent = 0
        for (const ws of workspaces) {
            const slot = retentionDigestSlot(now, ws.timezone)
            if (!slot.due) continue

            // Claim the whole run so the engine does not execute every minute
            // of the 10:00 hour.
            const refId = `${ws.id}:${slot.localYmd}`
            try {
                await this.prisma.notificationDispatchLog.create({
                    data: { kind: 'retention.digest.run', refId },
                })
            } catch (e) {
                if ((e as { code?: string }).code === 'P2002') continue
                throw e
            }
            ran += 1

            try {
                sent += await this.digestWorkspace(ws, slot.localYmd, now)
            } catch (e) {
                // Release the claim so the next tick retries; the per-coach
                // dedupe keys keep anyone already notified from a second push.
                await this.prisma.notificationDispatchLog.deleteMany({
                    where: { kind: 'retention.digest.run', refId },
                })
                throw e
            }
        }
        return { workspaces: ran, sent }
    }

    private async digestWorkspace(
        ws: { id: string; name: string; ownerId: string },
        localYmd: string,
        now: Date,
    ): Promise<number> {
        const [entries, coachRows, staffRows] = await Promise.all([
            loadWorkspaceRisk(this.prisma, { workspaceId: ws.id, now }),
            this.prisma.groupCoach.findMany({
                where: { group: { workspaceId: ws.id } },
                select: { userId: true, groupId: true },
            }),
            this.prisma.workspaceMember.findMany({
                where: {
                    workspaceId: ws.id,
                    status: 'ACTIVE',
                    role: { name: { in: COACHING_ROLES } },
                },
                select: { userId: true },
            }),
        ])
        // The owner has no WorkspaceMember row. A removed, suspended or
        // demoted coach can still sit in GroupCoach and gets nothing.
        const current = new Set(staffRows.map((r) => r.userId))
        current.add(ws.ownerId)

        let sent = 0
        for (const [coachId, c] of coachDigestCounts(entries, coachRows)) {
            if (c.total === 0 || !current.has(coachId)) continue
            const delivered = await this.notifications.notifyUser({
                userId: coachId,
                kind: 'retention.digest',
                refId: `${ws.id}:${coachId}:${localYmd}`,
                topic: 'Кому позвонить на этой неделе',
                message: `${ws.name}: ${c.total} ${pluralRu(c.total, 'ученик', 'ученика', 'учеников')} из ваших групп ${pluralRu(c.total, 'может', 'могут', 'могут')} уйти. Откройте список и позвоните.`,
                metadata: {
                    workspaceId: ws.id,
                    count: c.total,
                    byReason: c.byReason,
                },
            })
            if (delivered) sent += 1
        }
        return sent
    }
}
