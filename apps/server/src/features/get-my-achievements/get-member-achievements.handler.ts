import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import {
    GetMemberAchievementsFeature,
    GetMemberAchievementsFeatureResponse,
} from './get-member-achievements.feature'
import { loadAchievementConfigs } from './load-configs'
import { loadMemberStats } from './load-member-stats'

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
        const [configs, rows] = await Promise.all([
            loadAchievementConfigs(this.prisma, f.workspaceId),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId: f.workspaceId, userId: f.memberUserId },
                select: {
                    markedAt: true,
                    session: { select: { startAt: true } },
                },
                orderBy: { markedAt: 'asc' },
            }),
        ])
        const now = new Date()
        const stats = await loadMemberStats(
            this.prisma,
            f.workspaceId,
            f.memberUserId,
            rows.map((r) => r.session.startAt),
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
