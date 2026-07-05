import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    SetLeaderboardVisibilityFeature,
    SetLeaderboardVisibilityFeatureResponse,
} from './set-leaderboard-visibility.feature'

// Flip the caller's own leaderboard opt-out. Uses updateMany so the owner —
// who has no WorkspaceMember row — is a no-op rather than an error; owners
// aren't on the board anyway, so we report `hidden: false` back to them.
@Feature(SetLeaderboardVisibilityFeature)
export class SetLeaderboardVisibilityHandler
    implements
        IFeatureHandler<
            SetLeaderboardVisibilityFeature,
            SetLeaderboardVisibilityFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        workspaceId,
        userId,
        hidden,
    }: SetLeaderboardVisibilityFeature) {
        const res = await this.prisma.workspaceMember.updateMany({
            where: { workspaceId, userId },
            data: { hideFromLeaderboard: hidden },
        })
        return { hidden: res.count > 0 ? hidden : false }
    }
}
