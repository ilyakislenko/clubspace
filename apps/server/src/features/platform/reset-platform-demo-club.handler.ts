import { Feature, IFeatureHandler } from '@shelfjs/features'

import { DemoClubService } from '../../domains/demo/demo-club.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { LeaderboardCacheService } from '../attendance-leaderboard/leaderboard-cache.service'
import {
    ResetPlatformDemoClubFeature,
    ResetPlatformDemoClubFeatureResponse,
} from './reset-platform-demo-club.feature'

// Every client cache the demo club's phones hold: after a reset they refetch.
const DEMO_RESOURCES = [
    'about',
    'announcements',
    'attendance',
    'courses',
    'directions',
    'freeze-requests',
    'leaderboard',
    'members',
    'payments',
    'ranks',
    'schedule',
    'subscription',
]

// «Сбросить демо»: wipes ONLY the chosen demo club (ACADEMY or «Ритм») and
// generates it again with dates relative to today; the other one stays as it
// is. DemoClubService refuses unless DEMO_MODE is on and the club holding that
// demo key was generated as a demo.
@Feature(ResetPlatformDemoClubFeature)
export class ResetPlatformDemoClubHandler
    implements
        IFeatureHandler<ResetPlatformDemoClubFeature, ResetPlatformDemoClubFeatureResponse>
{
    constructor(
        private readonly demoClub: DemoClubService,
        private readonly leaderboardCache: LeaderboardCacheService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ResetPlatformDemoClubFeature): Promise<ResetPlatformDemoClubFeatureResponse> {
        assertPlatformAdmin(f.isSuperAdmin)
        const result = await this.demoClub.reset({ club: f.club, actorId: f.invokerUserId })
        await this.leaderboardCache.invalidate(result.workspaceId)
        this.realtime.invalidate(result.workspaceId, DEMO_RESOURCES)
        return result
    }
}
