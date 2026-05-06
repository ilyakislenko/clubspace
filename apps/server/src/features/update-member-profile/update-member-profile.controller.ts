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
    UpdateMemberProfileFeature,
    UpdateMemberProfileFeatureInputSchema,
    UpdateMemberProfileFeatureOutputSchema,
    UpdateMemberProfileFeatureResponse,
} from './update-member-profile.feature'

class UpdateMemberProfileBody extends createZodDto(
    UpdateMemberProfileFeatureInputSchema,
) {}
class UpdateMemberProfileOutput extends createZodDto(
    UpdateMemberProfileFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class UpdateMemberProfileController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':userId/profile')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateMemberProfileOutput })
    async updateProfile(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Body() body: UpdateMemberProfileBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateMemberProfileFeature,
            UpdateMemberProfileFeatureResponse
        >(
            new UpdateMemberProfileFeature(
                body,
                workspaceId,
                userId,
                user.userId,
            ),
        )
    }
}
