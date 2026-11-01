import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common'
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
    CheckPaymentConnectionFeature,
    CheckPaymentConnectionOutputSchema,
    type CheckPaymentConnectionFeatureResponse,
} from './check-payment-connection.feature'
import {
    DeletePaymentSettingsFeature,
    type DeletePaymentSettingsFeatureResponse,
} from './delete-payment-settings.feature'
import {
    GetPaymentSettingsFeature,
    GetPaymentSettingsOutputSchema,
    type GetPaymentSettingsFeatureResponse,
} from './get-payment-settings.feature'
import {
    UpdatePaymentSettingsFeature,
    UpdatePaymentSettingsInputSchema,
    type UpdatePaymentSettingsFeatureResponse,
} from './update-payment-settings.feature'

class PaymentSettingsOutput extends createZodDto(
    GetPaymentSettingsOutputSchema,
) {}
class UpdatePaymentSettingsInput extends createZodDto(
    UpdatePaymentSettingsInputSchema,
) {}
class CheckPaymentConnectionOutput extends createZodDto(
    CheckPaymentConnectionOutputSchema,
) {}

// «Онлайн-оплата»: the club's provider keys. Admin-only — they move money.
@Controller('workspaces/:workspaceId/payment-settings')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class PaymentSettingsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: PaymentSettingsOutput })
    async getPaymentSettings(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetPaymentSettingsFeature,
            GetPaymentSettingsFeatureResponse
        >(
            new GetPaymentSettingsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Put()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: PaymentSettingsOutput })
    async updatePaymentSettings(
        @Param('workspaceId') workspaceId: string,
        @Body() body: UpdatePaymentSettingsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdatePaymentSettingsFeature,
            UpdatePaymentSettingsFeatureResponse
        >(
            new UpdatePaymentSettingsFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: PaymentSettingsOutput })
    async deletePaymentSettings(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeletePaymentSettingsFeature,
            DeletePaymentSettingsFeatureResponse
        >(
            new DeletePaymentSettingsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('check')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: CheckPaymentConnectionOutput })
    async checkPaymentConnection(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CheckPaymentConnectionFeature,
            CheckPaymentConnectionFeatureResponse
        >(
            new CheckPaymentConnectionFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
