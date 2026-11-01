import { Injectable } from '@nestjs/common'

import {
    sessionDirectionId,
    sessionDirectionSelect,
} from '../../domains/directions/direction-scope'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    achievementValue,
    checkInsByDirection,
    scopedCheckIns,
} from './achievements-math'
import { loadAchievementConfigs } from './load-configs'

@Injectable()
export class AchievementNotifierService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    /**
     * Celebrate any achievement whose metric just reached its threshold for
     * these members (everyone a check-in or a coach's mark just counted).
     * Fires only at the exact moment the threshold is first hit
     * (value === threshold), which avoids a backfill burst for veterans; a
     * direction achievement's value counts only that direction's visits. The
     * producer's per-(kind,refId) claim (refId encodes the user) then
     * guarantees exactly once. One history query covers the whole batch.
     * Throws on failure: callers run it after commit (CheckInFollowUpService),
     * which reports the error without affecting attendance.
     */
    async notifyUnlocked(userIds: string[], workspaceId: string): Promise<void> {
        if (userIds.length === 0) return
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { achievementsEnabled: true },
        })
        // A club with achievements off gets no celebrations (and skips the
        // full-history computation).
        if (workspace?.achievementsEnabled === false) return
        const [{ configs }, rows] = await Promise.all([
            loadAchievementConfigs(this.prisma, workspaceId),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId, userId: { in: userIds } },
                select: {
                    userId: true,
                    markedAt: true,
                    session: { select: sessionDirectionSelect },
                },
                orderBy: { markedAt: 'asc' },
            }),
        ])
        const history = new Map<
            string,
            { markedAt: Date; directionId: string | null }[]
        >()
        for (const r of rows) {
            const visit = {
                markedAt: r.markedAt,
                directionId: sessionDirectionId(r.session),
            }
            const visits = history.get(r.userId)
            if (visits) visits.push(visit)
            else history.set(r.userId, [visit])
        }
        for (const userId of userIds) {
            const visits = history.get(userId) ?? []
            const all = visits.map((v) => v.markedAt)
            const byDirection = checkInsByDirection(visits)
            for (const c of configs) {
                const value = achievementValue(
                    c,
                    scopedCheckIns(c, all, byDirection),
                )
                if (value !== c.threshold) continue
                await this.notifications.notifyUser({
                    userId,
                    kind: 'achievement.unlocked',
                    refId: `${userId}:${c.id}`,
                    topic: 'Новое достижение 🏆',
                    message: `Открыто: ${c.name}`,
                    metadata: { achievementId: c.id },
                    category: 'promotionsEnabled',
                    workspaceId,
                    feature: 'achievements',
                })
            }
        }
    }
}
