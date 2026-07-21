import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import {
    GetMyAchievementsFeature,
    GetMyAchievementsFeatureResponse,
} from './get-my-achievements.feature'

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
        const rows = await this.prisma.attendanceRecord.findMany({
            where: { workspaceId: f.workspaceId, userId: f.userId },
            select: { markedAt: true },
            orderBy: { markedAt: 'asc' },
        })
        return computeAchievements(
            rows.map((r) => r.markedAt),
            new Date(),
        )
    }
}
