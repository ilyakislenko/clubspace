import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { RequiresFeature } from '../../shared/decorators/requires-feature.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { FeatureEnabledGuard } from '../../shared/guards/feature-enabled.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CancelSubscriptionFreezeRequestFeature,
    type CancelSubscriptionFreezeRequestFeatureResponse,
} from './cancel-subscription-freeze-request.feature'
import {
    RequestSubscriptionFreezeFeature,
    RequestSubscriptionFreezeFeatureOutputSchema,
    RequestSubscriptionFreezeInputSchema,
    type RequestSubscriptionFreezeFeatureResponse,
} from './request-subscription-freeze.feature'

class RequestSubscriptionFreezeInput extends createZodDto(
    RequestSubscriptionFreezeInputSchema,
) {}
class SubscriptionFreezeRequestOutput extends createZodDto(
    RequestSubscriptionFreezeFeatureOutputSchema,
) {}

// A member's own freeze requests — member-scoped, no @Roles.
@Controller('workspaces/:workspaceId/me/subscription/freeze-requests')
@UseGuards(AuthGuard, WorkspaceMemberGuard, FeatureEnabledGuard, RoleGuard)
@RequiresFeature('subscription')
export class MyFreezeRequestsController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: SubscriptionFreezeRequestOutput })
    async requestSubscriptionFreeze(
        @Param('workspaceId') workspaceId: string,
        @Body() body: RequestSubscriptionFreezeInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RequestSubscriptionFreezeFeature,
            RequestSubscriptionFreezeFeatureResponse
        >(new RequestSubscriptionFreezeFeature(body, workspaceId, user.userId))
    }

    @Post(':requestId/cancel')
    @ZodResponse({ type: SubscriptionFreezeRequestOutput })
    async cancelSubscriptionFreezeRequest(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId') requestId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CancelSubscriptionFreezeRequestFeature,
            CancelSubscriptionFreezeRequestFeatureResponse
        >(
            new CancelSubscriptionFreezeRequestFeature(
                workspaceId,
                requestId,
                user.userId,
            ),
        )
    }
}
