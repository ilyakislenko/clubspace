import { Injectable } from '@nestjs/common'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import { loadAchievementConfigs } from './load-configs'

@Injectable()
export class AchievementNotifierService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    /**
     * Celebrate any achievement whose metric just reached its threshold for
     * this member. Best-effort — never throws, so a caller can run it after a
     * check-in without risking the check-in. Fires only at the exact moment the
     * threshold is first hit (value === threshold), which avoids a backfill
     * burst for veterans; the producer's per-(kind,refId) claim (refId encodes
     * the user) then guarantees exactly once.
     */
    async notifyUnlocked(userId: string, workspaceId: string): Promise<void> {
        try {
            const [configs, rows] = await Promise.all([
                loadAchievementConfigs(this.prisma, workspaceId),
                this.prisma.attendanceRecord.findMany({
                    where: { workspaceId, userId },
                    select: { markedAt: true },
                    orderBy: { markedAt: 'asc' },
                }),
            ])
            const { totalCheckIns, longestStreakWeeks } = computeAchievements(
                configs,
                rows.map((r) => r.markedAt),
                new Date(),
            )
            for (const c of configs) {
                const value =
                    c.metric === 'streak' ? longestStreakWeeks : totalCheckIns
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
                    feature: 'attendance',
                })
            }
        } catch {
            // Celebrations are best-effort and must never affect attendance.
        }
    }
}
