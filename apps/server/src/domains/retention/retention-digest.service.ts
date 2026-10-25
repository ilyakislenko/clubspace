import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/prisma'
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
            select: { id: true, name: true, timezone: true },
        })

        let ran = 0
        let sent = 0
        for (const ws of workspaces) {
            const slot = retentionDigestSlot(now, ws.timezone)
            if (!slot.due) continue

            // Claim the whole run so the engine does not execute every minute
            // of the 10:00 hour.
            try {
                await this.prisma.notificationDispatchLog.create({
                    data: {
                        kind: 'retention.digest.run',
                        refId: `${ws.id}:${slot.localYmd}`,
                    },
                })
            } catch (e) {
                if ((e as { code?: string }).code === 'P2002') continue
                throw e
            }
            ran += 1

            const [entries, coachRows] = await Promise.all([
                loadWorkspaceRisk(this.prisma, { workspaceId: ws.id, now }),
                this.prisma.groupCoach.findMany({
                    where: { group: { workspaceId: ws.id } },
                    select: { userId: true, groupId: true },
                }),
            ])

            for (const [coachId, c] of coachDigestCounts(entries, coachRows)) {
                if (c.total === 0) continue
                const delivered = await this.notifications.notifyUser({
                    userId: coachId,
                    kind: 'retention.digest',
                    refId: `${ws.id}:${coachId}:${slot.localYmd}`,
                    topic: 'Кому позвонить на этой неделе',
                    message: `${ws.name}: ${c.total} ${pluralRu(c.total, 'ученик', 'ученика', 'учеников')} из ваших групп могут уйти. Откройте список и позвоните.`,
                    metadata: {
                        workspaceId: ws.id,
                        count: c.total,
                        byReason: c.byReason,
                    },
                })
                if (delivered) sent += 1
            }
        }
        return { workspaces: ran, sent }
    }
}
