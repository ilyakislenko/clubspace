import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListOpenRequestsFeature,
    type ListOpenRequestsFeatureResponse,
    ListOpenRequestsInputSchema,
    ListOpenRequestsOutputSchema,
} from './list-open-requests.feature'

class ListOpenRequestsQuery extends createZodDto(ListOpenRequestsInputSchema) {}
class ListOpenRequestsOutput extends createZodDto(ListOpenRequestsOutputSchema) {}

// No FeatureEnabledGuard: «Сегодня» reads this on every load, and the club's
// sections are applied per kind inside.
@Controller('workspaces/:workspaceId/requests')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class RequestsController {
    constructor(private bus: FeaturesBus) {}

    // Coach-scope read (resolveCoachScope in the handler).
    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListOpenRequestsOutput })
    async listOpenRequests(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListOpenRequestsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListOpenRequestsFeature, ListOpenRequestsFeatureResponse>(
            new ListOpenRequestsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
