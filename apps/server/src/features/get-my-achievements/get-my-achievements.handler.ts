import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    GetMyAchievementsFeature,
    GetMyAchievementsFeatureResponse,
} from './get-my-achievements.feature'
import { loadMemberAchievements } from './member-achievements'

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
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { achievementsEnabled: true },
        })
        // Off: no achievement list, but the streak and weekly bars (shared with
        // the attendance card) still come back — never a 403 for the app.
        const achievementsOn = workspace?.achievementsEnabled !== false
        return loadMemberAchievements(
            this.prisma,
            f.workspaceId,
            f.userId,
            achievementsOn,
        )
    }
}
