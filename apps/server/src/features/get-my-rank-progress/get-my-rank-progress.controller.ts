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
    GetMyRankProgressFeature,
    GetMyRankProgressOutputSchema,
    type GetMyRankProgressFeatureResponse,
} from './get-my-rank-progress.feature'

class MyRankProgressOutput extends createZodDto(
    GetMyRankProgressOutputSchema,
) {}

// Any workspace member reads their own progress — no @Roles.
@Controller('workspaces/:workspaceId/me/rank-progress')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetMyRankProgressController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: MyRankProgressOutput })
    async getMyRankProgress(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetMyRankProgressFeature,
            GetMyRankProgressFeatureResponse
        >(new GetMyRankProgressFeature(workspaceId, user.userId))
    }
}
