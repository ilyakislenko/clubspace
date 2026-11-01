import { Controller, Get, Param, UseGuards } from '@nestjs/common'
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

class GetWorkspaceBillingOutput extends createZodDto(
    GetWorkspaceBillingOutputSchema,
) {}

@Controller('workspaces/:workspaceId/billing')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class WorkspaceBillingController {
    constructor(private bus: FeaturesBus) {}

    // Open in a suspended club: this page is where its admin sees why and
    // what to do about it.
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
}
