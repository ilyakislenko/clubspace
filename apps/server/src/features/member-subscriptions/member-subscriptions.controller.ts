import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    COACHING_ROLES,
    Roles,
    STAFF_ROLES,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AssignSubscriptionFeature,
    AssignSubscriptionFeatureOutputSchema,
    AssignSubscriptionInputSchema,
    type AssignSubscriptionFeatureResponse,
} from './assign-subscription.feature'
import {
    CancelSubscriptionFeature,
    CancelSubscriptionOutputSchema,
    type CancelSubscriptionFeatureResponse,
} from './cancel-subscription.feature'
import {
    EndSubscriptionFreezeFeature,
    EndSubscriptionFreezeFeatureOutputSchema,
    type EndSubscriptionFreezeFeatureResponse,
} from './end-subscription-freeze.feature'
import {
    FreezeSubscriptionFeature,
    FreezeSubscriptionFeatureOutputSchema,
    FreezeSubscriptionInputSchema,
    type FreezeSubscriptionFeatureResponse,
} from './freeze-subscription.feature'
import {
    ListMemberSubscriptionsFeature,
    ListMemberSubscriptionsOutputSchema,
    type ListMemberSubscriptionsFeatureResponse,
} from './list-member-subscriptions.feature'
import {
    MarkSubscriptionPaidFeature,
    MarkSubscriptionPaidFeatureOutputSchema,
    MarkSubscriptionPaidInputSchema,
    type MarkSubscriptionPaidFeatureResponse,
} from './mark-subscription-paid.feature'

class AssignSubscriptionInput extends createZodDto(
    AssignSubscriptionInputSchema,
) {}
class AssignSubscriptionOutput extends createZodDto(
    AssignSubscriptionFeatureOutputSchema,
) {}
class MemberSubscriptionsOutput extends createZodDto(
    ListMemberSubscriptionsOutputSchema,
) {}
class CancelSubscriptionOutput extends createZodDto(
    CancelSubscriptionOutputSchema,
) {}

class FreezeSubscriptionInput extends createZodDto(
    FreezeSubscriptionInputSchema,
) {}
class FreezeSubscriptionOutput extends createZodDto(
    FreezeSubscriptionFeatureOutputSchema,
) {}
class EndSubscriptionFreezeOutput extends createZodDto(
    EndSubscriptionFreezeFeatureOutputSchema,
) {}

class MarkSubscriptionPaidInput extends createZodDto(
    MarkSubscriptionPaidInputSchema,
) {}
class MarkSubscriptionPaidOutput extends createZodDto(
    MarkSubscriptionPaidFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members/:userId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class MemberSubscriptionsController {
    constructor(private bus: FeaturesBus) {}

    @Post('subscription')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: AssignSubscriptionOutput })
    async assignSubscription(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Body() body: AssignSubscriptionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AssignSubscriptionFeature,
            AssignSubscriptionFeatureResponse
        >(
            new AssignSubscriptionFeature(
                body,
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('subscriptions')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: MemberSubscriptionsOutput })
    async listMemberSubscriptions(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListMemberSubscriptionsFeature,
            ListMemberSubscriptionsFeatureResponse
        >(
            new ListMemberSubscriptionsFeature(
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('subscriptions/:subscriptionId/cancel')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: CancelSubscriptionOutput })
    async cancelSubscription(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Param('subscriptionId') subscriptionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CancelSubscriptionFeature,
            CancelSubscriptionFeatureResponse
        >(
            new CancelSubscriptionFeature(
                workspaceId,
                userId,
                subscriptionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('subscriptions/:subscriptionId/payment')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: MarkSubscriptionPaidOutput })
    async markSubscriptionPaid(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Param('subscriptionId') subscriptionId: string,
        @Body() body: MarkSubscriptionPaidInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            MarkSubscriptionPaidFeature,
            MarkSubscriptionPaidFeatureResponse
        >(
            new MarkSubscriptionPaidFeature(
                body,
                workspaceId,
                userId,
                subscriptionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('subscriptions/:subscriptionId/freezes')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: FreezeSubscriptionOutput })
    async freezeSubscription(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Param('subscriptionId') subscriptionId: string,
        @Body() body: FreezeSubscriptionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            FreezeSubscriptionFeature,
            FreezeSubscriptionFeatureResponse
        >(
            new FreezeSubscriptionFeature(
                body,
                workspaceId,
                userId,
                subscriptionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('subscriptions/:subscriptionId/freezes/:freezeId/end')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: EndSubscriptionFreezeOutput })
    async endSubscriptionFreeze(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Param('subscriptionId') subscriptionId: string,
        @Param('freezeId') freezeId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            EndSubscriptionFreezeFeature,
            EndSubscriptionFreezeFeatureResponse
        >(
            new EndSubscriptionFreezeFeature(
                workspaceId,
                userId,
                subscriptionId,
                freezeId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
