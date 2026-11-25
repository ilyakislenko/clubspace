import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Query,
    UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AllowExpiredAccess } from '../../shared/decorators/allow-expired-access.decorator'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CheckoutQuoteOutputSchema,
    GetCheckoutQuoteFeature,
    GetCheckoutQuoteQuerySchema,
    type GetCheckoutQuoteFeatureResponse,
} from './get-checkout-quote.feature'
import {
    GetMyPaymentFeature,
    GetMyPaymentOutputSchema,
    type GetMyPaymentFeatureResponse,
} from './get-my-payment.feature'
import {
    GetOnlinePurchaseOptionsFeature,
    GetOnlinePurchaseOptionsOutputSchema,
    type GetOnlinePurchaseOptionsFeatureResponse,
} from './get-online-purchase-options.feature'

class OnlinePurchaseOptionsOutput extends createZodDto(
    GetOnlinePurchaseOptionsOutputSchema,
) {}
class MyPaymentOutput extends createZodDto(GetMyPaymentOutputSchema) {}
class GetCheckoutQuoteQuery extends createZodDto(GetCheckoutQuoteQuerySchema) {}
class CheckoutQuoteOutput extends createZodDto(CheckoutQuoteOutputSchema) {}

// The member's side of online payments. Open to a member whose access ran
// out — the lock screen offers «Оплатить онлайн».
@Controller('workspaces/:workspaceId/me')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class MyPaymentsController {
    constructor(private bus: FeaturesBus) {}

    @Get('online-purchase')
    @AllowExpiredAccess()
    @ZodResponse({ type: OnlinePurchaseOptionsOutput })
    async getOnlinePurchaseOptions(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetOnlinePurchaseOptionsFeature,
            GetOnlinePurchaseOptionsFeatureResponse
        >(
            new GetOnlinePurchaseOptionsFeature(
                workspaceId,
                user.userId,
                user.guardianId ?? user.userId,
            ),
        )
    }

    // The price before paying (a promo code optional), act-as like the
    // checkouts. Codes aren't secrets, but a guesser is slowed down: 20 a
    // minute per person (docs/design/2026-11-15-discounts.md §12).
    @Get('checkout-quote')
    @AllowExpiredAccess()
    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @ZodResponse({ type: CheckoutQuoteOutput })
    async getCheckoutQuote(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetCheckoutQuoteQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetCheckoutQuoteFeature, GetCheckoutQuoteFeatureResponse>(
            new GetCheckoutQuoteFeature(
                query,
                workspaceId,
                user.userId,
                user.guardianId ?? user.userId,
            ),
        )
    }

    @Get('payments/:paymentId')
    @AllowExpiredAccess()
    @ZodResponse({ type: MyPaymentOutput })
    async getMyPayment(
        @Param('workspaceId') workspaceId: string,
        @Param('paymentId', ParseUUIDPipe) paymentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetMyPaymentFeature, GetMyPaymentFeatureResponse>(
            new GetMyPaymentFeature(workspaceId, paymentId, user.userId),
        )
    }
}
