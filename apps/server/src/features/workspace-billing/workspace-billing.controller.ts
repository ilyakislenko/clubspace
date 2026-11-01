import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AllowSuspendedWorkspace } from '../../shared/decorators/allow-suspended-workspace.decorator'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetWorkspaceBillingFeature,
    GetWorkspaceBillingFeatureResponse,
    GetWorkspaceBillingOutputSchema,
} from './get-workspace-billing.feature'
import {
    GetWorkspaceBillingPaymentFeature,
    GetWorkspaceBillingPaymentFeatureResponse,
    GetWorkspaceBillingPaymentOutputSchema,
    ListWorkspaceBillingPaymentsFeature,
    ListWorkspaceBillingPaymentsFeatureResponse,
    ListWorkspaceBillingPaymentsOutputSchema,
    RemoveWorkspaceBillingCardFeature,
    RemoveWorkspaceBillingCardFeatureResponse,
    RemoveWorkspaceBillingCardOutputSchema,
    SetWorkspaceBillingModuleFeature,
    SetWorkspaceBillingModuleFeatureResponse,
    SetWorkspaceBillingModuleInputSchema,
    SetWorkspaceBillingModuleOutputSchema,
    SetWorkspaceBillingPeriodFeature,
    SetWorkspaceBillingPeriodFeatureResponse,
    SetWorkspaceBillingPeriodInputSchema,
    SetWorkspaceBillingPeriodOutputSchema,
    StartWorkspaceBillingCardCheckFeature,
    StartWorkspaceBillingCardCheckFeatureResponse,
    StartWorkspaceBillingCardCheckOutputSchema,
    StartWorkspaceBillingCheckoutFeature,
    StartWorkspaceBillingCheckoutFeatureResponse,
    StartWorkspaceBillingCheckoutInputSchema,
    StartWorkspaceBillingCheckoutOutputSchema,
} from './workspace-billing-payments.feature'

class GetWorkspaceBillingOutput extends createZodDto(
    GetWorkspaceBillingOutputSchema,
) {}
class StartWorkspaceBillingCheckoutInputDto extends createZodDto(
    StartWorkspaceBillingCheckoutInputSchema,
) {}
class StartWorkspaceBillingCheckoutOutput extends createZodDto(
    StartWorkspaceBillingCheckoutOutputSchema,
) {}
class StartWorkspaceBillingCardCheckOutput extends createZodDto(
    StartWorkspaceBillingCardCheckOutputSchema,
) {}
class SetWorkspaceBillingModuleInputDto extends createZodDto(
    SetWorkspaceBillingModuleInputSchema,
) {}
class SetWorkspaceBillingModuleOutput extends createZodDto(
    SetWorkspaceBillingModuleOutputSchema,
) {}
class ListWorkspaceBillingPaymentsOutput extends createZodDto(
    ListWorkspaceBillingPaymentsOutputSchema,
) {}
class GetWorkspaceBillingPaymentOutput extends createZodDto(
    GetWorkspaceBillingPaymentOutputSchema,
) {}
class RemoveWorkspaceBillingCardOutput extends createZodDto(
    RemoveWorkspaceBillingCardOutputSchema,
) {}
class SetWorkspaceBillingPeriodInputDto extends createZodDto(
    SetWorkspaceBillingPeriodInputSchema,
) {}
class SetWorkspaceBillingPeriodOutput extends createZodDto(
    SetWorkspaceBillingPeriodOutputSchema,
) {}

// The club's «Тариф» page. Everything but the module switch stays open in a
// suspended club: this page is where its admin sees why and pays.
@Controller('workspaces/:workspaceId/billing')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class WorkspaceBillingController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: GetWorkspaceBillingOutput })
    async getWorkspaceBilling(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetWorkspaceBillingFeature,
            GetWorkspaceBillingFeatureResponse
        >(
            new GetWorkspaceBillingFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('checkout')
    @Roles(WORKSPACE_ADMINS)
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: StartWorkspaceBillingCheckoutOutput })
    async startWorkspaceBillingCheckout(
        @Param('workspaceId') workspaceId: string,
        @Body() body: StartWorkspaceBillingCheckoutInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            StartWorkspaceBillingCheckoutFeature,
            StartWorkspaceBillingCheckoutFeatureResponse
        >(
            new StartWorkspaceBillingCheckoutFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('card')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: StartWorkspaceBillingCardCheckOutput })
    async startWorkspaceBillingCardCheck(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            StartWorkspaceBillingCardCheckFeature,
            StartWorkspaceBillingCardCheckFeatureResponse
        >(
            new StartWorkspaceBillingCardCheckFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('modules')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: SetWorkspaceBillingModuleOutput })
    async setWorkspaceBillingModule(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SetWorkspaceBillingModuleInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SetWorkspaceBillingModuleFeature,
            SetWorkspaceBillingModuleFeatureResponse
        >(
            new SetWorkspaceBillingModuleFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('payments')
    @Roles(WORKSPACE_ADMINS)
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: ListWorkspaceBillingPaymentsOutput })
    async listWorkspaceBillingPayments(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListWorkspaceBillingPaymentsFeature,
            ListWorkspaceBillingPaymentsFeatureResponse
        >(
            new ListWorkspaceBillingPaymentsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('payments/:paymentId')
    @Roles(WORKSPACE_ADMINS)
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: GetWorkspaceBillingPaymentOutput })
    async getWorkspaceBillingPayment(
        @Param('workspaceId') workspaceId: string,
        @Param('paymentId', ParseUUIDPipe) paymentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetWorkspaceBillingPaymentFeature,
            GetWorkspaceBillingPaymentFeatureResponse
        >(
            new GetWorkspaceBillingPaymentFeature(
                paymentId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('payment-method')
    @Roles(WORKSPACE_ADMINS)
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: RemoveWorkspaceBillingCardOutput })
    async removeWorkspaceBillingCard(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RemoveWorkspaceBillingCardFeature,
            RemoveWorkspaceBillingCardFeatureResponse
        >(
            new RemoveWorkspaceBillingCardFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Put('period')
    @Roles(WORKSPACE_ADMINS)
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: SetWorkspaceBillingPeriodOutput })
    async setWorkspaceBillingPeriod(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SetWorkspaceBillingPeriodInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SetWorkspaceBillingPeriodFeature,
            SetWorkspaceBillingPeriodFeatureResponse
        >(
            new SetWorkspaceBillingPeriodFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
