import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { STAFF_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListPendingUsersFeature,
    ListPendingUsersFeatureOutputSchema,
    ListPendingUsersFeatureResponse,
} from './list-pending-users.feature'

class ListPendingUsersOutput extends createZodDto(
    ListPendingUsersFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/pending-users')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(STAFF_ROLES)
export class ListPendingUsersController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListPendingUsersOutput })
    async listPending(@Param('workspaceId') workspaceId: string) {
        return await this.bus.execute<
            ListPendingUsersFeature,
            ListPendingUsersFeatureResponse
        >(new ListPendingUsersFeature(workspaceId))
    }
}
