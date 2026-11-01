import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AllowExpiredAccess } from '../../shared/decorators/allow-expired-access.decorator'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
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
    ListPaymentsFeature,
    ListPaymentsInputSchema,
    ListPaymentsOutputSchema,
    type ListPaymentsFeatureResponse,
} from './list-payments.feature'
import {
    RefundPaymentFeature,
    RefundPaymentOutputSchema,
    type RefundPaymentFeatureResponse,
} from './refund-payment.feature'

class CreatePaymentInput extends createZodDto(CreatePaymentInputSchema) {}
class CreatePaymentOutput extends createZodDto(CreatePaymentOutputSchema) {}
class ListPaymentsQuery extends createZodDto(ListPaymentsInputSchema) {}
class ListPaymentsOutput extends createZodDto(ListPaymentsOutputSchema) {}
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

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListPaymentsOutput })
    async listPayments(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListPaymentsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListPaymentsFeature, ListPaymentsFeatureResponse>(
            new ListPaymentsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':paymentId/refund')
    @Roles(WORKSPACE_ADMINS)
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
