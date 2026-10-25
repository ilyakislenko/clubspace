import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import {
    GetMemberAchievementsFeature,
    GetMemberAchievementsFeatureResponse,
} from './get-member-achievements.feature'
import { loadAchievementConfigs } from './load-configs'
import {
    buildMemberStats,
    countCompletedSubscriptions,
} from './load-member-stats'

@Feature(GetMemberAchievementsFeature)
export class GetMemberAchievementsHandler
    implements
        IFeatureHandler<
            GetMemberAchievementsFeature,
            GetMemberAchievementsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMemberAchievementsFeature) {
        const now = new Date()
        const [configs, rows, completed] = await Promise.all([
            loadAchievementConfigs(this.prisma, f.workspaceId),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId: f.workspaceId, userId: f.memberUserId },
                select: {
                    markedAt: true,
                    session: { select: { startAt: true, timezone: true } },
                },
                orderBy: { markedAt: 'asc' },
            }),
            countCompletedSubscriptions(
                this.prisma,
                f.workspaceId,
                f.memberUserId,
                now,
            ),
        ])
        const stats = buildMemberStats(
            rows.map((r) => r.session),
            completed,
            now,
        )
        return {
            ...computeAchievements(
                configs,
                rows.map((r) => r.markedAt),
                now,
            ),
            stats,
        }
    }
}
