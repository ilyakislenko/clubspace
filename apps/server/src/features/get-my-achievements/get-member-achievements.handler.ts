import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import {
    GetMemberAchievementsFeature,
    GetMemberAchievementsFeatureResponse,
} from './get-member-achievements.feature'

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
        const rows = await this.prisma.attendanceRecord.findMany({
            where: { workspaceId: f.workspaceId, userId: f.memberUserId },
            select: { markedAt: true },
            orderBy: { markedAt: 'asc' },
        })
        return computeAchievements(
            rows.map((r) => r.markedAt),
            new Date(),
        )
    }
}
