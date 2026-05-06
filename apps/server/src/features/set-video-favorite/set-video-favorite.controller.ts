import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    Put,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    SetVideoFavoriteFeature,
    SetVideoFavoriteFeatureInputSchema,
    SetVideoFavoriteFeatureOutputSchema,
    SetVideoFavoriteFeatureResponse,
} from './set-video-favorite.feature'

class SetVideoFavoriteInput extends createZodDto(
    SetVideoFavoriteFeatureInputSchema,
) {}

class SetVideoFavoriteOutput extends createZodDto(
    SetVideoFavoriteFeatureOutputSchema,
) {}

@Controller('videos/:videoId/favorite')
@UseGuards(AuthGuard)
export class SetVideoFavoriteController {
    constructor(private bus: FeaturesBus) {}

    @Put()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: SetVideoFavoriteOutput })
    async setFavorite(
        @CurrentUser() user: CurrentUserPayload,
        @Param('videoId') videoId: string,
        @Body() body: SetVideoFavoriteInput,
    ) {
        return await this.bus.execute<
            SetVideoFavoriteFeature,
            SetVideoFavoriteFeatureResponse
        >(new SetVideoFavoriteFeature(user.userId, videoId, body))
    }
}
