import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
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
    GetWorkspaceOnboardingHelpFeature,
    GetWorkspaceOnboardingHelpFeatureResponse,
    GetWorkspaceOnboardingHelpOutputSchema,
    RequestWorkspaceOnboardingHelpFeature,
    RequestWorkspaceOnboardingHelpFeatureResponse,
    RequestWorkspaceOnboardingHelpInputSchema,
    RequestWorkspaceOnboardingHelpOutputSchema,
} from './onboarding-help.feature'

class GetWorkspaceOnboardingHelpOutput extends createZodDto(
    GetWorkspaceOnboardingHelpOutputSchema,
) {}
class RequestWorkspaceOnboardingHelpInputDto extends createZodDto(
    RequestWorkspaceOnboardingHelpInputSchema,
) {}
class RequestWorkspaceOnboardingHelpOutput extends createZodDto(
    RequestWorkspaceOnboardingHelpOutputSchema,
) {}

// «Запросить помощь с подключением» on the club's «Тариф» page.
@Controller('workspaces/:workspaceId/onboarding-help')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class WorkspaceOnboardingHelpController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: GetWorkspaceOnboardingHelpOutput })
    async getWorkspaceOnboardingHelp(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetWorkspaceOnboardingHelpFeature,
            GetWorkspaceOnboardingHelpFeatureResponse
        >(
            new GetWorkspaceOnboardingHelpFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RequestWorkspaceOnboardingHelpOutput })
    async requestWorkspaceOnboardingHelp(
        @Param('workspaceId') workspaceId: string,
        @Body() body: RequestWorkspaceOnboardingHelpInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RequestWorkspaceOnboardingHelpFeature,
            RequestWorkspaceOnboardingHelpFeatureResponse
        >(
            new RequestWorkspaceOnboardingHelpFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
