import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AllowExpiredAccess } from '../../shared/decorators/allow-expired-access.decorator'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, CLUB_ADMINS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreatePaymentFeature,
    CreatePaymentInputSchema,
    CreatePaymentOutputSchema,
    type CreatePaymentFeatureResponse,
} from './create-payment.feature'
import {
    RefundPaymentFeature,
    RefundPaymentOutputSchema,
    type RefundPaymentFeatureResponse,
} from './refund-payment.feature'

class CreatePaymentInput extends createZodDto(CreatePaymentInputSchema) {}
class CreatePaymentOutput extends createZodDto(CreatePaymentOutputSchema) {}
class RefundPaymentOutput extends createZodDto(RefundPaymentOutputSchema) {}

@Controller('workspaces/:workspaceId/payments')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class PaymentsController {
    constructor(private bus: FeaturesBus) {}

    // Any member buys for themselves — including one whose access ran out:
    // paying is how they get it back.
    @Post()
    @AllowExpiredAccess()
    @ZodResponse({ type: CreatePaymentOutput })
    async createPayment(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreatePaymentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CreatePaymentFeature, CreatePaymentFeatureResponse>(
            new CreatePaymentFeature(body, workspaceId, user.userId),
        )
    }

    @Post(':paymentId/refund')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: RefundPaymentOutput })
    async refundPayment(
        @Param('workspaceId') workspaceId: string,
        @Param('paymentId', ParseUUIDPipe) paymentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<RefundPaymentFeature, RefundPaymentFeatureResponse>(
            new RefundPaymentFeature(
                workspaceId,
                paymentId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
