import {
    Body,
    Controller,
    Get,
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
import { ActAsAllowed } from '../../shared/decorators/act-as.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetMyVideoNoteFeature,
    GetMyVideoNoteFeatureOutputSchema,
    GetMyVideoNoteFeatureResponse,
} from './get-my-video-note.feature'
import {
    PutMyVideoNoteFeature,
    PutMyVideoNoteFeatureInputSchema,
    PutMyVideoNoteFeatureOutputSchema,
    PutMyVideoNoteFeatureResponse,
} from './put-my-video-note.feature'

class GetMyVideoNoteOutput extends createZodDto(
    GetMyVideoNoteFeatureOutputSchema,
) {}

class PutMyVideoNoteInput extends createZodDto(
    PutMyVideoNoteFeatureInputSchema,
) {}

class PutMyVideoNoteOutput extends createZodDto(
    PutMyVideoNoteFeatureOutputSchema,
) {}

@Controller('videos/:videoId/my-note')
@UseGuards(AuthGuard)
export class MyVideoNoteController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ActAsAllowed()
    @ZodResponse({ type: GetMyVideoNoteOutput })
    async getMyVideoNote(
        @CurrentUser() user: CurrentUserPayload,
        @Param('videoId') videoId: string,
    ) {
        return await this.bus.execute<
            GetMyVideoNoteFeature,
            GetMyVideoNoteFeatureResponse
        >(new GetMyVideoNoteFeature(user.userId, videoId))
    }

    @Put()
    @ActAsAllowed()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: PutMyVideoNoteOutput })
    async putMyVideoNote(
        @CurrentUser() user: CurrentUserPayload,
        @Param('videoId') videoId: string,
        @Body() body: PutMyVideoNoteInput,
    ) {
        return await this.bus.execute<
            PutMyVideoNoteFeature,
            PutMyVideoNoteFeatureResponse
        >(new PutMyVideoNoteFeature(user.userId, videoId, body))
    }
}
