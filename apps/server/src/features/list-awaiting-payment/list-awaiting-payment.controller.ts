import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AwaitingPaymentOutputSchema,
    ListAwaitingPaymentFeature,
    type ListAwaitingPaymentFeatureResponse,
} from './list-awaiting-payment.feature'

class AwaitingPaymentOutput extends createZodDto(
    AwaitingPaymentOutputSchema,
) {}

@Controller('workspaces/:workspaceId/awaiting-payment')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AwaitingPaymentController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: AwaitingPaymentOutput })
    async listAwaitingPayment(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListAwaitingPaymentFeature,
            ListAwaitingPaymentFeatureResponse
        >(
            new ListAwaitingPaymentFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
