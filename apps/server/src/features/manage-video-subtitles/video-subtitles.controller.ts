import {
    Body,
    Controller,
    Delete,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateVideoSubtitleUploadFeature,
    CreateVideoSubtitleUploadFeatureInputSchema,
    CreateVideoSubtitleUploadFeatureOutputSchema,
    CreateVideoSubtitleUploadFeatureResponse,
} from './create-video-subtitle-upload.feature'
import {
    CreateVideoSubtitleFeature,
    CreateVideoSubtitleFeatureInputSchema,
    VideoSubtitleOutputSchema,
    type VideoSubtitleResponse,
} from './create-video-subtitle.feature'
import {
    DeleteVideoSubtitleFeature,
    DeleteVideoSubtitleFeatureOutputSchema,
    type DeleteVideoSubtitleFeatureResponse,
} from './delete-video-subtitle.feature'

class CreateVideoSubtitleUploadInput extends createZodDto(
    CreateVideoSubtitleUploadFeatureInputSchema,
) {}

class CreateVideoSubtitleUploadOutput extends createZodDto(
    CreateVideoSubtitleUploadFeatureOutputSchema,
) {}

class CreateVideoSubtitleInput extends createZodDto(
    CreateVideoSubtitleFeatureInputSchema,
) {}

class VideoSubtitleOutput extends createZodDto(VideoSubtitleOutputSchema) {}

class DeleteVideoSubtitleOutput extends createZodDto(
    DeleteVideoSubtitleFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/videos/:videoId/subtitles')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class VideoSubtitlesController {
    constructor(private bus: FeaturesBus) {}

    @Post('upload-url')
    @ZodResponse({ type: CreateVideoSubtitleUploadOutput })
    async createUploadUrl(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Body() body: CreateVideoSubtitleUploadInput,
    ) {
        return await this.bus.execute<
            CreateVideoSubtitleUploadFeature,
            CreateVideoSubtitleUploadFeatureResponse
        >(new CreateVideoSubtitleUploadFeature(body, workspaceId, videoId))
    }

    @Post()
    @ZodResponse({ type: VideoSubtitleOutput })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Body() body: CreateVideoSubtitleInput,
    ) {
        return await this.bus.execute<
            CreateVideoSubtitleFeature,
            VideoSubtitleResponse
        >(new CreateVideoSubtitleFeature(body, workspaceId, videoId))
    }

    @Delete(':subtitleId')
    @ZodResponse({ type: DeleteVideoSubtitleOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Param('subtitleId') subtitleId: string,
    ) {
        return await this.bus.execute<
            DeleteVideoSubtitleFeature,
            DeleteVideoSubtitleFeatureResponse
        >(new DeleteVideoSubtitleFeature(workspaceId, videoId, subtitleId))
    }
}
