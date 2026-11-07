import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
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
    ListMyVideoBookmarksFeature,
    ListMyVideoBookmarksFeatureOutputSchema,
    ListMyVideoBookmarksFeatureResponse,
} from './list-my-video-bookmarks.feature'
import {
    PutMyVideoBookmarkFeature,
    PutMyVideoBookmarkFeatureInputSchema,
    PutMyVideoBookmarkFeatureOutputSchema,
    PutMyVideoBookmarkFeatureResponse,
} from './put-my-video-bookmark.feature'

class ListMyVideoBookmarksOutput extends createZodDto(
    ListMyVideoBookmarksFeatureOutputSchema,
) {}

class PutMyVideoBookmarkInput extends createZodDto(
    PutMyVideoBookmarkFeatureInputSchema,
) {}

class PutMyVideoBookmarkOutput extends createZodDto(
    PutMyVideoBookmarkFeatureOutputSchema,
) {}

@Controller('videos/:videoId/my-bookmarks')
@UseGuards(AuthGuard)
export class MyVideoBookmarksController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ActAsAllowed()
    @ZodResponse({ type: ListMyVideoBookmarksOutput })
    async listMyVideoBookmarks(
        @CurrentUser() user: CurrentUserPayload,
        @Param('videoId') videoId: string,
    ) {
        return await this.bus.execute<
            ListMyVideoBookmarksFeature,
            ListMyVideoBookmarksFeatureResponse
        >(new ListMyVideoBookmarksFeature(user.userId, videoId))
    }

    @Put(':bookmarkId')
    @ActAsAllowed()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: PutMyVideoBookmarkOutput })
    async putMyVideoBookmark(
        @CurrentUser() user: CurrentUserPayload,
        @Param('videoId') videoId: string,
        @Param('bookmarkId', ParseUUIDPipe) bookmarkId: string,
        @Body() body: PutMyVideoBookmarkInput,
    ) {
        return await this.bus.execute<
            PutMyVideoBookmarkFeature,
            PutMyVideoBookmarkFeatureResponse
        >(new PutMyVideoBookmarkFeature(user.userId, videoId, bookmarkId, body))
    }
}
