import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreatePlaylistThumbnailUploadFeature,
    CreatePlaylistThumbnailUploadFeatureInputSchema,
    CreatePlaylistThumbnailUploadFeatureOutputSchema,
    CreatePlaylistThumbnailUploadFeatureResponse,
} from './create-playlist-thumbnail-upload.feature'

class CreatePlaylistThumbnailUploadInput extends createZodDto(
    CreatePlaylistThumbnailUploadFeatureInputSchema,
) {}

class CreatePlaylistThumbnailUploadOutput extends createZodDto(
    CreatePlaylistThumbnailUploadFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class CreatePlaylistThumbnailUploadController {
    constructor(private bus: FeaturesBus) {}

    @Post(':playlistId/thumbnail-upload')
    @ZodResponse({ type: CreatePlaylistThumbnailUploadOutput })
    async createThumbnailUpload(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Body() input: CreatePlaylistThumbnailUploadInput,
    ) {
        return await this.bus.execute<
            CreatePlaylistThumbnailUploadFeature,
            CreatePlaylistThumbnailUploadFeatureResponse
        >(
            new CreatePlaylistThumbnailUploadFeature(
                input,
                workspaceId,
                playlistId,
            ),
        )
    }
}
