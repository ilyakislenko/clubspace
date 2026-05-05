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
    UpdateWorkspaceSettingsFeature,
    UpdateWorkspaceSettingsFeatureInputSchema,
    UpdateWorkspaceSettingsFeatureOutputSchema,
    UpdateWorkspaceSettingsFeatureResponse,
} from './update-workspace-settings.feature'

class UpdateWorkspaceSettingsBody extends createZodDto(
    UpdateWorkspaceSettingsFeatureInputSchema,
) {}
class UpdateWorkspaceSettingsOutput extends createZodDto(
    UpdateWorkspaceSettingsFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/settings')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class UpdateWorkspaceSettingsController {
    constructor(private bus: FeaturesBus) {}

    @Patch()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateWorkspaceSettingsOutput })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Body() body: UpdateWorkspaceSettingsBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateWorkspaceSettingsFeature,
            UpdateWorkspaceSettingsFeatureResponse
        >(
            new UpdateWorkspaceSettingsFeature(body, workspaceId, user.userId),
        )
    }
}
