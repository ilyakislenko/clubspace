import {
    Body,
    Controller,
    Get,
    Param,
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
    ListPlatformPlansFeature,
    ListPlatformPlansFeatureResponse,
    ListPlatformPlansOutputSchema,
} from './list-platform-plans.feature'
import {
    UpdatePlatformWorkspaceBillingFeature,
    UpdatePlatformWorkspaceBillingFeatureResponse,
    UpdatePlatformWorkspaceBillingInputSchema,
    UpdatePlatformWorkspaceBillingOutputSchema,
} from './update-platform-workspace-billing.feature'

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
class ListPlatformPlansOutput extends createZodDto(
    ListPlatformPlansOutputSchema,
) {}
class UpdatePlatformWorkspaceBillingInputDto extends createZodDto(
    UpdatePlatformWorkspaceBillingInputSchema,
) {}
class UpdatePlatformWorkspaceBillingOutput extends createZodDto(
    UpdatePlatformWorkspaceBillingOutputSchema,
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

    @Get('plans')
    @ZodResponse({ type: ListPlatformPlansOutput })
    async listPlatformPlans(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            ListPlatformPlansFeature,
            ListPlatformPlansFeatureResponse
        >(new ListPlatformPlansFeature(user.userId, user.isSuperAdmin))
    }

    @Post('workspaces/:workspaceId/billing')
    @ZodResponse({ type: UpdatePlatformWorkspaceBillingOutput })
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
}
