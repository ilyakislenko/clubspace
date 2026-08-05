import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
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
    ListGroupsFeature,
    ListGroupsFeatureInputSchema,
    ListGroupsFeatureOutputSchema,
    ListGroupsFeatureResponse,
} from './list-groups.feature'

class ListGroupsQuery extends createZodDto(ListGroupsFeatureInputSchema) {}

class ListGroupsOutput extends createZodDto(ListGroupsFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListGroupsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListGroupsOutput })
    async listGroups(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
        @Query() query: ListGroupsQuery,
    ) {
        return await this.bus.execute<
            ListGroupsFeature,
            ListGroupsFeatureResponse
        >(
            new ListGroupsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
                query,
            ),
        )
    }
}
