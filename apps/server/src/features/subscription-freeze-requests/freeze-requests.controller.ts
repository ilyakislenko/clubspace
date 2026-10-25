import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ApproveSubscriptionFreezeRequestFeature,
    ApproveSubscriptionFreezeRequestFeatureOutputSchema,
    ApproveSubscriptionFreezeRequestInputSchema,
    type ApproveSubscriptionFreezeRequestFeatureResponse,
} from './approve-subscription-freeze-request.feature'
import {
    DeclineSubscriptionFreezeRequestFeature,
    DeclineSubscriptionFreezeRequestFeatureOutputSchema,
    DeclineSubscriptionFreezeRequestInputSchema,
    type DeclineSubscriptionFreezeRequestFeatureResponse,
} from './decline-subscription-freeze-request.feature'
import {
    ListPendingFreezeRequestsFeature,
    ListPendingFreezeRequestsFeatureOutputSchema,
    type ListPendingFreezeRequestsFeatureResponse,
} from './list-pending-freeze-requests.feature'

class PendingFreezeRequestsOutput extends createZodDto(
    ListPendingFreezeRequestsFeatureOutputSchema,
) {}
class ApproveSubscriptionFreezeRequestInput extends createZodDto(
    ApproveSubscriptionFreezeRequestInputSchema,
) {}
class ApproveSubscriptionFreezeRequestOutput extends createZodDto(
    ApproveSubscriptionFreezeRequestFeatureOutputSchema,
) {}
class DeclineSubscriptionFreezeRequestInput extends createZodDto(
    DeclineSubscriptionFreezeRequestInputSchema,
) {}
class DecidedFreezeRequestOutput extends createZodDto(
    DeclineSubscriptionFreezeRequestFeatureOutputSchema,
) {}

// Staff side of freeze requests. Deciding is checked in the handlers (a coach
// decides only members of their own groups).
@Controller('workspaces/:workspaceId/freeze-requests')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class FreezeRequestsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: PendingFreezeRequestsOutput })
    async listPendingFreezeRequests(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPendingFreezeRequestsFeature,
            ListPendingFreezeRequestsFeatureResponse
        >(
            new ListPendingFreezeRequestsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':requestId/approve')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ApproveSubscriptionFreezeRequestOutput })
    async approveSubscriptionFreezeRequest(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId') requestId: string,
        @Body() body: ApproveSubscriptionFreezeRequestInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ApproveSubscriptionFreezeRequestFeature,
            ApproveSubscriptionFreezeRequestFeatureResponse
        >(
            new ApproveSubscriptionFreezeRequestFeature(
                body,
                workspaceId,
                requestId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':requestId/decline')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DecidedFreezeRequestOutput })
    async declineSubscriptionFreezeRequest(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId') requestId: string,
        @Body() body: DeclineSubscriptionFreezeRequestInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeclineSubscriptionFreezeRequestFeature,
            DeclineSubscriptionFreezeRequestFeatureResponse
        >(
            new DeclineSubscriptionFreezeRequestFeature(
                body,
                workspaceId,
                requestId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
