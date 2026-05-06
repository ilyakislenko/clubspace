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
    ListAuditEventsFeature,
    ListAuditEventsFeatureInputSchema,
    ListAuditEventsFeatureOutputSchema,
    ListAuditEventsFeatureResponse,
} from './list-audit-events.feature'

class ListAuditEventsQuery extends createZodDto(
    ListAuditEventsFeatureInputSchema,
) {}

class ListAuditEventsOutput extends createZodDto(
    ListAuditEventsFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/audit-events')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListAuditEventsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListAuditEventsOutput })
    async listEvents(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListAuditEventsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListAuditEventsFeature,
            ListAuditEventsFeatureResponse
        >(
            new ListAuditEventsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
