import { Controller, Get, Param, UseGuards } from '@nestjs/common'
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
    GetMyAchievementsFeature,
    GetMyAchievementsOutputSchema,
    type GetMyAchievementsFeatureResponse,
} from './get-my-achievements.feature'

class MyAchievementsOutput extends createZodDto(
    GetMyAchievementsOutputSchema,
) {}

// Any workspace member reads their own achievements — no @Roles. Not gated by
// the achievements flag: the weekly bars share this payload (the handler just
// returns no achievements when the section is off).
@Controller('workspaces/:workspaceId/me/achievements')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetMyAchievementsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: MyAchievementsOutput })
    async getMyAchievements(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetMyAchievementsFeature,
            GetMyAchievementsFeatureResponse
        >(new GetMyAchievementsFeature(workspaceId, user.userId))
    }
}
