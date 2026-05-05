import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetWorkspaceStatsFeature,
    GetWorkspaceStatsFeatureOutputSchema,
    GetWorkspaceStatsFeatureResponse,
} from './get-workspace-stats.feature'

class GetWorkspaceStatsOutput extends createZodDto(
    GetWorkspaceStatsFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/stats')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetWorkspaceStatsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetWorkspaceStatsOutput })
    async getStats(@Param('workspaceId') workspaceId: string) {
        return await this.bus.execute<
            GetWorkspaceStatsFeature,
            GetWorkspaceStatsFeatureResponse
        >(new GetWorkspaceStatsFeature(workspaceId))
    }
}
