import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    UpdateMemberRoleFeature,
    UpdateMemberRoleFeatureInputSchema,
    UpdateMemberRoleFeatureOutputSchema,
    UpdateMemberRoleFeatureResponse,
} from './update-member-role.feature'

class UpdateMemberRoleBody extends createZodDto(
    UpdateMemberRoleFeatureInputSchema,
) {}
class UpdateMemberRoleOutput extends createZodDto(
    UpdateMemberRoleFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class UpdateMemberRoleController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':userId/role')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateMemberRoleOutput })
    async updateRole(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Body() body: UpdateMemberRoleBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateMemberRoleFeature,
            UpdateMemberRoleFeatureResponse
        >(new UpdateMemberRoleFeature(body, workspaceId, userId, user.userId))
    }
}
