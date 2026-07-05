import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetAttendanceLeaderboardFeature,
    GetAttendanceLeaderboardInputSchema,
    GetAttendanceLeaderboardOutputSchema,
    type GetAttendanceLeaderboardFeatureResponse,
} from './get-attendance-leaderboard.feature'
import {
    SetLeaderboardVisibilityFeature,
    SetLeaderboardVisibilityInputSchema,
    SetLeaderboardVisibilityOutputSchema,
    type SetLeaderboardVisibilityFeatureResponse,
} from './set-leaderboard-visibility.feature'

class AttendanceLeaderboardQuery extends createZodDto(
    GetAttendanceLeaderboardInputSchema,
) {}
class AttendanceLeaderboardOutput extends createZodDto(
    GetAttendanceLeaderboardOutputSchema,
) {}
class SetLeaderboardVisibilityInput extends createZodDto(
    SetLeaderboardVisibilityInputSchema,
) {}
class SetLeaderboardVisibilityOutput extends createZodDto(
    SetLeaderboardVisibilityOutputSchema,
) {}

// Any workspace member (owner included) reads the board and toggles their own
// visibility — no @Roles.
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class LeaderboardController {
    constructor(private bus: FeaturesBus) {}

    @Get('leaderboard')
    @ZodResponse({ type: AttendanceLeaderboardOutput })
    async getAttendanceLeaderboard(
        @Param('workspaceId') workspaceId: string,
        @Query() query: AttendanceLeaderboardQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetAttendanceLeaderboardFeature,
            GetAttendanceLeaderboardFeatureResponse
        >(
            new GetAttendanceLeaderboardFeature(workspaceId, user.userId, query),
        )
    }

    @Patch('me/leaderboard-visibility')
    @ZodResponse({ type: SetLeaderboardVisibilityOutput })
    async setLeaderboardVisibility(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SetLeaderboardVisibilityInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            SetLeaderboardVisibilityFeature,
            SetLeaderboardVisibilityFeatureResponse
        >(
            new SetLeaderboardVisibilityFeature(
                workspaceId,
                user.userId,
                body.hidden,
            ),
        )
    }
}
