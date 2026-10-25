import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import {
    JoinWorkspaceFeature,
    JoinWorkspaceFeatureInputSchema,
    JoinWorkspaceFeatureOutputSchema,
    type JoinWorkspaceFeatureResponse,
} from './join-workspace.feature'

class JoinWorkspaceInput extends createZodDto(
    JoinWorkspaceFeatureInputSchema,
) {}
class JoinWorkspaceOutput extends createZodDto(
    JoinWorkspaceFeatureOutputSchema,
) {}

// AuthGuard only, no WorkspaceMemberGuard: the caller is by definition not a
// member of the club yet.
@Controller('workspaces')
@UseGuards(AuthGuard)
export class JoinWorkspaceController {
    constructor(private bus: FeaturesBus) {}

    // The code is guessable in principle, so this is the brute-force gate:
    // 10 tries a minute per person, and 120 an hour per address (a whole gym
    // joins off one poster, so the address bucket has to be generous).
    @Post('join')
    @Throttle({
        short: { ttl: 60_000, limit: 10 },
        default: { ttl: 3_600_000, limit: 120, getTracker: trackByClientIp },
    })
    @ZodResponse({ type: JoinWorkspaceOutput })
    async joinWorkspaceByCode(
        @Body() body: JoinWorkspaceInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            JoinWorkspaceFeature,
            JoinWorkspaceFeatureResponse
        >(new JoinWorkspaceFeature(body, user.userId))
    }
}
