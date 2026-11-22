import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { ActAsAllowed } from '../../shared/decorators/act-as.decorator'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    ReviewMyBookmarkFeature,
    ReviewMyBookmarkFeatureInputSchema,
    ReviewMyBookmarkFeatureOutputSchema,
    ReviewMyBookmarkFeatureResponse,
} from './review-my-bookmark.feature'

class ReviewMyBookmarkInput extends createZodDto(
    ReviewMyBookmarkFeatureInputSchema,
) {}

class ReviewMyBookmarkOutput extends createZodDto(
    ReviewMyBookmarkFeatureOutputSchema,
) {}

@Controller('videos/:videoId/my-bookmarks/:bookmarkId/review')
@UseGuards(AuthGuard)
export class ReviewMyBookmarkController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ActAsAllowed()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: ReviewMyBookmarkOutput })
    async reviewMyBookmark(
        @CurrentUser() user: CurrentUserPayload,
        @Param('videoId') videoId: string,
        @Param('bookmarkId', ParseUUIDPipe) bookmarkId: string,
        @Body() body: ReviewMyBookmarkInput,
    ) {
        return await this.bus.execute<
            ReviewMyBookmarkFeature,
            ReviewMyBookmarkFeatureResponse
        >(new ReviewMyBookmarkFeature(user.userId, videoId, bookmarkId, body))
    }
}
