import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { LeaderboardCacheService } from './leaderboard-cache.service'
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
    constructor(
        private readonly prisma: PrismaService,
        private readonly leaderboard: LeaderboardCacheService,
    ) {}

    async execute({
        workspaceId,
        userId,
        hidden,
    }: SetLeaderboardVisibilityFeature) {
        const res = await this.prisma.workspaceMember.updateMany({
            where: { workspaceId, userId },
            data: { hideFromLeaderboard: hidden },
        })
        // The cached board would keep (or keep hiding) them for its TTL.
        if (res.count > 0) await this.leaderboard.invalidate(workspaceId)
        return { hidden: res.count > 0 ? hidden : false }
    }
}
