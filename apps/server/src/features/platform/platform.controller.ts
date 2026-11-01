import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { SuperAdminGuard } from '../../shared/guards/super-admin.guard'
import {
    CreatePlatformWorkspaceFeature,
    CreatePlatformWorkspaceFeatureResponse,
    CreatePlatformWorkspaceInputSchema,
    CreatePlatformWorkspaceOutputSchema,
} from './create-platform-workspace.feature'
import {
    GetPlatformOverviewFeature,
    GetPlatformOverviewFeatureResponse,
    GetPlatformOverviewOutputSchema,
} from './get-platform-overview.feature'
import {
    ListPlatformAuditFeature,
    ListPlatformAuditFeatureResponse,
    ListPlatformAuditInputSchema,
    ListPlatformAuditOutputSchema,
} from './list-platform-audit.feature'
import {
    ListPlatformWorkspacesFeature,
    ListPlatformWorkspacesFeatureResponse,
    ListPlatformWorkspacesInputSchema,
    ListPlatformWorkspacesOutputSchema,
} from './list-platform-workspaces.feature'
import {
    UpdatePlatformWorkspaceFeature,
    UpdatePlatformWorkspaceFeatureResponse,
    UpdatePlatformWorkspaceInputSchema,
    UpdatePlatformWorkspaceOutputSchema,
} from './update-platform-workspace.feature'
import {
    GetPlatformWorkspaceBillingFeature,
    GetPlatformWorkspaceBillingFeatureResponse,
} from './get-platform-workspace-billing.feature'
import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'
import {
    SetPlatformWorkspaceFeatureFeature,
    SetPlatformWorkspaceFeatureFeatureResponse,
    SetPlatformWorkspaceFeatureInputSchema,
} from './set-platform-workspace-feature.feature'
import {
    UpdatePlatformWorkspaceBillingFeature,
    UpdatePlatformWorkspaceBillingFeatureResponse,
    UpdatePlatformWorkspaceBillingInputSchema,
} from './update-platform-workspace-billing.feature'
import {
    UpdatePlatformWorkspaceModuleFeature,
    UpdatePlatformWorkspaceModuleFeatureResponse,
    UpdatePlatformWorkspaceModuleInputSchema,
} from './update-platform-workspace-module.feature'
import {
    ListPlatformWorkspacePaymentsFeature,
    ListPlatformWorkspacePaymentsFeatureResponse,
    ListPlatformWorkspacePaymentsOutputSchema,
    RefundPlatformWorkspacePaymentFeature,
    RefundPlatformWorkspacePaymentFeatureResponse,
    RefundPlatformWorkspacePaymentInputSchema,
    RefundPlatformWorkspacePaymentOutputSchema,
    RetryPlatformWorkspacePaymentFeature,
    RetryPlatformWorkspacePaymentFeatureResponse,
    RetryPlatformWorkspacePaymentOutputSchema,
    SetPlatformWorkspaceAutopayFeature,
    SetPlatformWorkspaceAutopayFeatureResponse,
    SetPlatformWorkspaceAutopayInputSchema,
} from './platform-workspace-payments.feature'
import {
    LockPlatformWorkspaceFeatureFeature,
    LockPlatformWorkspaceFeatureFeatureResponse,
    LockPlatformWorkspaceFeatureInputSchema,
    UnlockPlatformWorkspaceFeatureFeature,
    UnlockPlatformWorkspaceFeatureFeatureResponse,
} from './platform-feature-locks.feature'
import {
    ApplyPlatformWorkspacePromoFeature,
    ApplyPlatformWorkspacePromoFeatureResponse,
    PlatformWorkspacePromoInputSchema,
    PreviewPlatformWorkspacePromoFeature,
    PreviewPlatformWorkspacePromoFeatureResponse,
    PreviewPlatformWorkspacePromoOutputSchema,
} from './platform-promo-presets.feature'

class ListPlatformWorkspacesQueryDto extends createZodDto(
    ListPlatformWorkspacesInputSchema,
) {}
class ListPlatformWorkspacesOutput extends createZodDto(
    ListPlatformWorkspacesOutputSchema,
) {}
class CreatePlatformWorkspaceInputDto extends createZodDto(
    CreatePlatformWorkspaceInputSchema,
) {}
class CreatePlatformWorkspaceOutput extends createZodDto(
    CreatePlatformWorkspaceOutputSchema,
) {}
class GetPlatformOverviewOutput extends createZodDto(
    GetPlatformOverviewOutputSchema,
) {}
class ListPlatformAuditQueryDto extends createZodDto(
    ListPlatformAuditInputSchema,
) {}
class ListPlatformAuditOutput extends createZodDto(
    ListPlatformAuditOutputSchema,
) {}
class UpdatePlatformWorkspaceInputDto extends createZodDto(
    UpdatePlatformWorkspaceInputSchema,
) {}
class UpdatePlatformWorkspaceOutput extends createZodDto(
    UpdatePlatformWorkspaceOutputSchema,
) {}
class UpdatePlatformWorkspaceBillingInputDto extends createZodDto(
    UpdatePlatformWorkspaceBillingInputSchema,
) {}
class UpdatePlatformWorkspaceModuleInputDto extends createZodDto(
    UpdatePlatformWorkspaceModuleInputSchema,
) {}
class SetPlatformWorkspaceFeatureInputDto extends createZodDto(
    SetPlatformWorkspaceFeatureInputSchema,
) {}
// One card shape for every console billing route (read and actions).
class PlatformWorkspaceBillingOutput extends createZodDto(
    PlatformWorkspaceBillingOutputSchema,
) {}
class ListPlatformWorkspacePaymentsOutput extends createZodDto(
    ListPlatformWorkspacePaymentsOutputSchema,
) {}
class RetryPlatformWorkspacePaymentOutput extends createZodDto(
    RetryPlatformWorkspacePaymentOutputSchema,
) {}
class RefundPlatformWorkspacePaymentInputDto extends createZodDto(
    RefundPlatformWorkspacePaymentInputSchema,
) {}
class RefundPlatformWorkspacePaymentOutput extends createZodDto(
    RefundPlatformWorkspacePaymentOutputSchema,
) {}
class SetPlatformWorkspaceAutopayInputDto extends createZodDto(
    SetPlatformWorkspaceAutopayInputSchema,
) {}
class LockPlatformWorkspaceFeatureInputDto extends createZodDto(
    LockPlatformWorkspaceFeatureInputSchema,
) {}
class PlatformWorkspacePromoInputDto extends createZodDto(
    PlatformWorkspacePromoInputSchema,
) {}
class PreviewPlatformWorkspacePromoOutput extends createZodDto(
    PreviewPlatformWorkspacePromoOutputSchema,
) {}

// The platform console: one tier above the per-workspace admin. Routes are not
// workspace-scoped, so the usual WorkspaceMemberGuard/RoleGuard pair does not
// apply — SuperAdminGuard is the whole gate, and each handler re-asserts.
@Controller('platform')
@UseGuards(AuthGuard, SuperAdminGuard)
export class PlatformController {
    constructor(private bus: FeaturesBus) {}

    @Get('overview')
    @ZodResponse({ type: GetPlatformOverviewOutput })
    async getPlatformOverview(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            GetPlatformOverviewFeature,
            GetPlatformOverviewFeatureResponse
        >(new GetPlatformOverviewFeature(user.userId, user.isSuperAdmin))
    }

    @Get('workspaces')
    @ZodResponse({ type: ListPlatformWorkspacesOutput })
    async listPlatformWorkspaces(
        @Query() query: ListPlatformWorkspacesQueryDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPlatformWorkspacesFeature,
            ListPlatformWorkspacesFeatureResponse
        >(
            new ListPlatformWorkspacesFeature(
                query,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces')
    @ZodResponse({ type: CreatePlatformWorkspaceOutput })
    async createPlatformWorkspace(
        @Body() body: CreatePlatformWorkspaceInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreatePlatformWorkspaceFeature,
            CreatePlatformWorkspaceFeatureResponse
        >(
            new CreatePlatformWorkspaceFeature(
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('audit')
    @ZodResponse({ type: ListPlatformAuditOutput })
    async listPlatformAudit(
        @Query() query: ListPlatformAuditQueryDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPlatformAuditFeature,
            ListPlatformAuditFeatureResponse
        >(new ListPlatformAuditFeature(query, user.userId, user.isSuperAdmin))
    }

    @Patch('workspaces/:workspaceId')
    @ZodResponse({ type: UpdatePlatformWorkspaceOutput })
    async updatePlatformWorkspace(
        @Param('workspaceId') workspaceId: string,
        @Body() body: UpdatePlatformWorkspaceInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlatformWorkspaceFeature,
            UpdatePlatformWorkspaceFeatureResponse
        >(
            new UpdatePlatformWorkspaceFeature(
                workspaceId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('workspaces/:workspaceId/billing')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async getPlatformWorkspaceBilling(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetPlatformWorkspaceBillingFeature,
            GetPlatformWorkspaceBillingFeatureResponse
        >(
            new GetPlatformWorkspaceBillingFeature(
                workspaceId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/billing')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async updatePlatformWorkspaceBilling(
        @Param('workspaceId') workspaceId: string,
        @Body() body: UpdatePlatformWorkspaceBillingInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlatformWorkspaceBillingFeature,
            UpdatePlatformWorkspaceBillingFeatureResponse
        >(
            new UpdatePlatformWorkspaceBillingFeature(
                workspaceId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/modules')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async updatePlatformWorkspaceModule(
        @Param('workspaceId') workspaceId: string,
        @Body() body: UpdatePlatformWorkspaceModuleInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlatformWorkspaceModuleFeature,
            UpdatePlatformWorkspaceModuleFeatureResponse
        >(
            new UpdatePlatformWorkspaceModuleFeature(
                workspaceId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/features')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async setPlatformWorkspaceFeature(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SetPlatformWorkspaceFeatureInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SetPlatformWorkspaceFeatureFeature,
            SetPlatformWorkspaceFeatureFeatureResponse
        >(
            new SetPlatformWorkspaceFeatureFeature(
                workspaceId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/feature-locks')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async lockPlatformWorkspaceFeature(
        @Param('workspaceId') workspaceId: string,
        @Body() body: LockPlatformWorkspaceFeatureInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            LockPlatformWorkspaceFeatureFeature,
            LockPlatformWorkspaceFeatureFeatureResponse
        >(
            new LockPlatformWorkspaceFeatureFeature(
                workspaceId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('workspaces/:workspaceId/feature-locks/:feature')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async unlockPlatformWorkspaceFeature(
        @Param('workspaceId') workspaceId: string,
        @Param('feature') feature: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UnlockPlatformWorkspaceFeatureFeature,
            UnlockPlatformWorkspaceFeatureFeatureResponse
        >(
            new UnlockPlatformWorkspaceFeatureFeature(
                workspaceId,
                feature,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/promos/preview')
    @ZodResponse({ type: PreviewPlatformWorkspacePromoOutput })
    async previewPlatformWorkspacePromo(
        @Param('workspaceId') workspaceId: string,
        @Body() body: PlatformWorkspacePromoInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            PreviewPlatformWorkspacePromoFeature,
            PreviewPlatformWorkspacePromoFeatureResponse
        >(
            new PreviewPlatformWorkspacePromoFeature(
                workspaceId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/promos')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async applyPlatformWorkspacePromo(
        @Param('workspaceId') workspaceId: string,
        @Body() body: PlatformWorkspacePromoInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ApplyPlatformWorkspacePromoFeature,
            ApplyPlatformWorkspacePromoFeatureResponse
        >(
            new ApplyPlatformWorkspacePromoFeature(
                workspaceId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('workspaces/:workspaceId/payments')
    @ZodResponse({ type: ListPlatformWorkspacePaymentsOutput })
    async listPlatformWorkspacePayments(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPlatformWorkspacePaymentsFeature,
            ListPlatformWorkspacePaymentsFeatureResponse
        >(
            new ListPlatformWorkspacePaymentsFeature(
                workspaceId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/payments/retry')
    @ZodResponse({ type: RetryPlatformWorkspacePaymentOutput })
    async retryPlatformWorkspacePayment(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RetryPlatformWorkspacePaymentFeature,
            RetryPlatformWorkspacePaymentFeatureResponse
        >(
            new RetryPlatformWorkspacePaymentFeature(
                workspaceId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/payments/:paymentId/refund')
    @ZodResponse({ type: RefundPlatformWorkspacePaymentOutput })
    async refundPlatformWorkspacePayment(
        @Param('workspaceId') workspaceId: string,
        @Param('paymentId', ParseUUIDPipe) paymentId: string,
        @Body() body: RefundPlatformWorkspacePaymentInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RefundPlatformWorkspacePaymentFeature,
            RefundPlatformWorkspacePaymentFeatureResponse
        >(
            new RefundPlatformWorkspacePaymentFeature(
                paymentId,
                body,
                workspaceId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('workspaces/:workspaceId/autopay')
    @ZodResponse({ type: PlatformWorkspaceBillingOutput })
    async setPlatformWorkspaceAutopay(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SetPlatformWorkspaceAutopayInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SetPlatformWorkspaceAutopayFeature,
            SetPlatformWorkspaceAutopayFeatureResponse
        >(
            new SetPlatformWorkspaceAutopayFeature(
                body,
                workspaceId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
