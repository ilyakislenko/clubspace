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
    UpdateWorkspaceMemberAccessFeature,
    UpdateWorkspaceMemberAccessFeatureInputSchema,
    UpdateWorkspaceMemberAccessFeatureOutputSchema,
    UpdateWorkspaceMemberAccessFeatureResponse,
} from './update-workspace-member-access.feature'

class UpdateWorkspaceMemberAccessBody extends createZodDto(
    UpdateWorkspaceMemberAccessFeatureInputSchema,
) {}

class UpdateWorkspaceMemberAccessOutput extends createZodDto(
    UpdateWorkspaceMemberAccessFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class UpdateWorkspaceMemberAccessController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':userId/access')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateWorkspaceMemberAccessOutput })
    async updateAccess(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Body() body: UpdateWorkspaceMemberAccessBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateWorkspaceMemberAccessFeature,
            UpdateWorkspaceMemberAccessFeatureResponse
        >(
            new UpdateWorkspaceMemberAccessFeature(
                body,
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
