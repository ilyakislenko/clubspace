import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
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
    CreatePaymentFeature,
    CreatePaymentInputSchema,
    CreatePaymentOutputSchema,
    type CreatePaymentFeatureResponse,
} from './create-payment.feature'

class CreatePaymentInput extends createZodDto(CreatePaymentInputSchema) {}
class CreatePaymentOutput extends createZodDto(CreatePaymentOutputSchema) {}

@Controller('workspaces/:workspaceId/payments')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class PaymentsController {
    constructor(private bus: FeaturesBus) {}

    // Any member buys for themselves — including one whose access ran out:
    // paying is how they get it back. A guardian buys for a child under
    // X-Act-As: the child holds the abonement, the guardian pays.
    @Post()
    @AllowExpiredAccess()
    @ZodResponse({ type: CreatePaymentOutput })
    async createPayment(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreatePaymentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CreatePaymentFeature, CreatePaymentFeatureResponse>(
            new CreatePaymentFeature(
                body,
                workspaceId,
                user.userId,
                user.guardianId ?? user.userId,
            ),
        )
    }
}
