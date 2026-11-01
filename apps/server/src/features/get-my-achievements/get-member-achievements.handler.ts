import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    GetMemberAchievementsFeature,
    GetMemberAchievementsFeatureResponse,
} from './get-member-achievements.feature'
import { loadMemberAchievements } from './member-achievements'

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
        return loadMemberAchievements(
            this.prisma,
            f.workspaceId,
            f.memberUserId,
            true,
        )
    }
}
