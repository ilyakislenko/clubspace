import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMySubscriptionFeature,
    GetMySubscriptionOutputSchema,
    type GetMySubscriptionFeatureResponse,
} from './get-my-subscription.feature'

class MySubscriptionOutput extends createZodDto(
    GetMySubscriptionOutputSchema,
) {}

// Any workspace member reads their own abonement — no @Roles.
@Controller('workspaces/:workspaceId/me/subscription')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetMySubscriptionController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: MySubscriptionOutput })
    async getMySubscription(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetMySubscriptionFeature,
            GetMySubscriptionFeatureResponse
        >(new GetMySubscriptionFeature(workspaceId, user.userId))
    }
}
