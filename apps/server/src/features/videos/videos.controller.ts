import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CompleteVideoUploadFeature,
    CompleteVideoUploadFeatureInputSchema,
    CompleteVideoUploadFeatureOutputSchema,
    CompleteVideoUploadFeatureResponse,
} from './complete-video-upload.feature'
import {
    CreateVideoUploadFeature,
    CreateVideoUploadFeatureInputSchema,
    CreateVideoUploadFeatureOutputSchema,
    CreateVideoUploadFeatureResponse,
} from './create-video-upload.feature'
import {
    GetVideoFeature,
    GetVideoFeatureInputSchema,
    GetVideoFeatureOutputSchema,
    GetVideoFeatureResponse,
} from './get-video.feature'
import {
    GetVideoPlaybackFeature,
    GetVideoPlaybackFeatureOutputSchema,
    GetVideoPlaybackFeatureResponse,
} from './get-video-playback.feature'

class CreateVideoUploadInput extends createZodDto(
    CreateVideoUploadFeatureInputSchema,
) {}

class CreateVideoUploadOutput extends createZodDto(
    CreateVideoUploadFeatureOutputSchema,
) {}

class CompleteVideoUploadInput extends createZodDto(
    CompleteVideoUploadFeatureInputSchema,
) {}

class CompleteVideoUploadOutput extends createZodDto(
    CompleteVideoUploadFeatureOutputSchema,
) {}

class GetVideoQuery extends createZodDto(GetVideoFeatureInputSchema) {}

class GetVideoOutput extends createZodDto(GetVideoFeatureOutputSchema) {}

class GetVideoPlaybackOutput extends createZodDto(
    GetVideoPlaybackFeatureOutputSchema,
) {}

@Controller('admin/videos')
export class VideosAdminController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @UseGuards(AuthGuard, WorkspaceMemberGuard)
    @ZodResponse({ type: CreateVideoUploadOutput })
    async createUpload(@Body() input: CreateVideoUploadInput) {
        return await this.bus.execute<
            CreateVideoUploadFeature,
            CreateVideoUploadFeatureResponse
        >(new CreateVideoUploadFeature(input))
    }

    @Post(':id/complete-upload')
    @UseGuards(AuthGuard, WorkspaceMemberGuard)
    @ZodResponse({ type: CompleteVideoUploadOutput })
    async completeUpload(
        @Param('id') id: string,
        @Body() input: CompleteVideoUploadInput,
    ) {
        return await this.bus.execute<
            CompleteVideoUploadFeature,
            CompleteVideoUploadFeatureResponse
        >(new CompleteVideoUploadFeature(input, id))
    }

    @Get(':id')
    @UseGuards(AuthGuard, WorkspaceMemberGuard)
    @ZodResponse({ type: GetVideoOutput })
    async getVideo(@Param('id') id: string, @Query() query: GetVideoQuery) {
        return await this.bus.execute<GetVideoFeature, GetVideoFeatureResponse>(
            new GetVideoFeature(query, id),
        )
    }
}

@Controller('videos')
export class VideoPlaybackController {
    constructor(private bus: FeaturesBus) {}

    @Get(':id/playback')
    @UseGuards(AuthGuard)
    @ZodResponse({ type: GetVideoPlaybackOutput })
    async getPlayback(
        @Param('id') id: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetVideoPlaybackFeature,
            GetVideoPlaybackFeatureResponse
        >(new GetVideoPlaybackFeature(id, user.userId))
    }
}
