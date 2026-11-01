import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards,
} from '@nestjs/common'
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
        >(new GetOnlinePurchaseOptionsFeature(workspaceId, user.userId))
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
