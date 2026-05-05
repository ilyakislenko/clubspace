import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { STAFF_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListWorkspaceMembersFeature,
    ListWorkspaceMembersFeatureOutputSchema,
    ListWorkspaceMembersFeatureResponse,
} from './list-workspace-members.feature'

class ListWorkspaceMembersOutput extends createZodDto(
    ListWorkspaceMembersFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListWorkspaceMembersController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListWorkspaceMembersOutput })
    async listMembers(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListWorkspaceMembersFeature,
            ListWorkspaceMembersFeatureResponse
        >(
            new ListWorkspaceMembersFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
