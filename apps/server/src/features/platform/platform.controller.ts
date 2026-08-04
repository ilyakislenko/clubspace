import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
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
    ListPlatformWorkspacesFeature,
    ListPlatformWorkspacesFeatureResponse,
    ListPlatformWorkspacesInputSchema,
    ListPlatformWorkspacesOutputSchema,
} from './list-platform-workspaces.feature'

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
}
