import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    SaveVideoProgressFeature,
    SaveVideoProgressFeatureInputSchema,
    SaveVideoProgressFeatureOutputSchema,
    SaveVideoProgressFeatureResponse,
} from './save-video-progress.feature'

class SaveVideoProgressInput extends createZodDto(
    SaveVideoProgressFeatureInputSchema,
) {}

class SaveVideoProgressOutput extends createZodDto(
    SaveVideoProgressFeatureOutputSchema,
) {}

@Controller('videos/:videoId/progress')
@UseGuards(AuthGuard)
export class SaveVideoProgressController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: SaveVideoProgressOutput })
    async save(
        @CurrentUser() user: CurrentUserPayload,
        @Param('videoId') videoId: string,
        @Body() body: SaveVideoProgressInput,
    ) {
        return await this.bus.execute<
            SaveVideoProgressFeature,
            SaveVideoProgressFeatureResponse
        >(new SaveVideoProgressFeature(user.userId, videoId, body))
    }
}
