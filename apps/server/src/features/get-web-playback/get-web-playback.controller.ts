import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { ActAsAllowed } from '../../shared/decorators/act-as.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetWebPlaybackFeature,
    GetWebPlaybackFeatureOutputSchema,
    GetWebPlaybackFeatureResponse,
} from './get-web-playback.feature'

class GetWebPlaybackOutput extends createZodDto(
    GetWebPlaybackFeatureOutputSchema,
) {}

// Access (membership, audience, progression) is checked in VideoService via
// CourseAccessService, like playback and offline.
@Controller('videos')
@UseGuards(AuthGuard)
export class GetWebPlaybackController {
    constructor(private bus: FeaturesBus) {}

    @Get(':id/web-playback')
    @ActAsAllowed()
    @ZodResponse({ type: GetWebPlaybackOutput })
    async getWebPlayback(
        @Param('id') id: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetWebPlaybackFeature,
            GetWebPlaybackFeatureResponse
        >(new GetWebPlaybackFeature(id, user.userId))
    }
}
