import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
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
    CreateClubLogoUploadFeature,
    CreateClubLogoUploadFeatureInputSchema,
    CreateClubLogoUploadFeatureOutputSchema,
    type CreateClubLogoUploadFeatureResponse,
} from './create-club-logo-upload.feature'
import {
    GetClubPublicProfileFeature,
    GetClubPublicProfileFeatureOutputSchema,
    type GetClubPublicProfileFeatureResponse,
} from './get-club-public-profile.feature'
import {
    UpdateClubPublicProfileFeature,
    UpdateClubPublicProfileFeatureInputSchema,
    UpdateClubPublicProfileFeatureOutputSchema,
    type UpdateClubPublicProfileFeatureResponse,
} from './update-club-public-profile.feature'

class ClubPublicProfileOutputDto extends createZodDto(
    GetClubPublicProfileFeatureOutputSchema,
) {}
class UpdateClubPublicProfileInput extends createZodDto(
    UpdateClubPublicProfileFeatureInputSchema,
) {}
class UpdateClubPublicProfileOutputDto extends createZodDto(
    UpdateClubPublicProfileFeatureOutputSchema,
) {}
class CreateClubLogoUploadInput extends createZodDto(
    CreateClubLogoUploadFeatureInputSchema,
) {}
class CreateClubLogoUploadOutputDto extends createZodDto(
    CreateClubLogoUploadFeatureOutputSchema,
) {}

// «Публичная страница»: what the club shows to people who are not members yet
// (app.<domain>/c/<slug>, the /join/<code> preview, club search). Workspace
// admins only — it is the club's public face.
@Controller('workspaces/:workspaceId/public-profile')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubPublicProfileController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ClubPublicProfileOutputDto })
    async getClubPublicProfile(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetClubPublicProfileFeature,
            GetClubPublicProfileFeatureResponse
        >(
            new GetClubPublicProfileFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Put()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateClubPublicProfileOutputDto })
    async updateClubPublicProfile(
        @Param('workspaceId') workspaceId: string,
        @Body() body: UpdateClubPublicProfileInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateClubPublicProfileFeature,
            UpdateClubPublicProfileFeatureResponse
        >(
            new UpdateClubPublicProfileFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('logo-upload')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: CreateClubLogoUploadOutputDto })
    async createClubLogoUpload(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateClubLogoUploadInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateClubLogoUploadFeature,
            CreateClubLogoUploadFeatureResponse
        >(
            new CreateClubLogoUploadFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
