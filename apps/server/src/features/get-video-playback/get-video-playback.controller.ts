import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetVideoPlaybackFeature,
    GetVideoPlaybackFeatureOutputSchema,
    GetVideoPlaybackFeatureResponse,
} from './get-video-playback.feature'

class GetVideoPlaybackOutput extends createZodDto(
    GetVideoPlaybackFeatureOutputSchema,
) {}

@Controller('videos')
@UseGuards(AuthGuard)
export class GetVideoPlaybackController {
    constructor(private bus: FeaturesBus) {}

    @Get(':id/playback')
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
