import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetWorkspaceSettingsFeature,
    GetWorkspaceSettingsFeatureOutputSchema,
    GetWorkspaceSettingsFeatureResponse,
} from './get-workspace-settings.feature'

class GetWorkspaceSettingsOutput extends createZodDto(
    GetWorkspaceSettingsFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/settings')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetWorkspaceSettingsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetWorkspaceSettingsOutput })
    async get(@Param('workspaceId') workspaceId: string) {
        return await this.bus.execute<
            GetWorkspaceSettingsFeature,
            GetWorkspaceSettingsFeatureResponse
        >(new GetWorkspaceSettingsFeature(workspaceId))
    }
}
