import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMyGroupsFeature,
    GetMyGroupsFeatureOutputSchema,
    GetMyGroupsFeatureResponse,
} from './get-my-groups.feature'

class GetMyGroupsOutput extends createZodDto(
    GetMyGroupsFeatureOutputSchema,
) {}

// No RoleGuard — every authenticated workspace member (including 'user')
// is allowed to see their own groups in the mobile app. The handler
// scopes by userId, so a coach sees their groups, a student sees theirs.
@Controller('workspaces/:workspaceId/me/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GetMyGroupsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetMyGroupsOutput })
    async getMyGroups(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyGroupsFeature,
            GetMyGroupsFeatureResponse
        >(new GetMyGroupsFeature(workspaceId, user.userId))
    }
}
