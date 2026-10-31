import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

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
    GetWorkspaceOnboardingFeature,
    GetWorkspaceOnboardingFeatureResponse,
    GetWorkspaceOnboardingOutputSchema,
} from './get-workspace-onboarding.feature'

class GetWorkspaceOnboardingOutput extends createZodDto(
    GetWorkspaceOnboardingOutputSchema,
) {}

@Controller('workspaces/:workspaceId/onboarding')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetWorkspaceOnboardingController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: GetWorkspaceOnboardingOutput })
    async getWorkspaceOnboarding(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetWorkspaceOnboardingFeature,
            GetWorkspaceOnboardingFeatureResponse
        >(
            new GetWorkspaceOnboardingFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
