import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import {
    GetMyAchievementsFeature,
    GetMyAchievementsFeatureResponse,
} from './get-my-achievements.feature'
import { loadAchievementConfigs } from './load-configs'

@Feature(GetMyAchievementsFeature)
export class GetMyAchievementsHandler
    implements
        IFeatureHandler<
            GetMyAchievementsFeature,
            GetMyAchievementsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMyAchievementsFeature) {
        const [configs, rows] = await Promise.all([
            loadAchievementConfigs(this.prisma, f.workspaceId),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                select: { markedAt: true },
                orderBy: { markedAt: 'asc' },
            }),
        ])
        return computeAchievements(
            configs,
            rows.map((r) => r.markedAt),
            new Date(),
        )
    }
}
