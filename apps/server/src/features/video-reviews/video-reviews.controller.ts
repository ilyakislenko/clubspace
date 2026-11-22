import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetVideoReviewPlaybackFeature,
    GetVideoReviewPlaybackFeatureOutputSchema,
    GetVideoReviewPlaybackFeatureResponse,
} from './get-video-review-playback.feature'
import {
    GetVideoReviewFeature,
    GetVideoReviewFeatureOutputSchema,
    GetVideoReviewFeatureResponse,
} from './get-video-review.feature'
import {
    ListClubVideoReviewsFeature,
    ListClubVideoReviewsFeatureInputSchema,
    ListClubVideoReviewsFeatureOutputSchema,
    ListClubVideoReviewsFeatureResponse,
} from './list-club-video-reviews.feature'
import type { ReviewViewerRole } from './review-clip-access'
import {
    SetVideoReviewStatusFeature,
    SetVideoReviewStatusFeatureInputSchema,
    SetVideoReviewStatusFeatureOutputSchema,
    SetVideoReviewStatusFeatureResponse,
} from './set-video-review-status.feature'
import {
    AddVideoReviewCommentFeature,
    AddVideoReviewCommentFeatureInputSchema,
    DeleteVideoReviewCommentFeature,
    UpdateVideoReviewCommentFeature,
    UpdateVideoReviewCommentFeatureInputSchema,
    VideoReviewCommentFeatureOutputSchema,
    VideoReviewCommentFeatureResponse,
} from './video-review-comment.feature'

class ListClubVideoReviewsQuery extends createZodDto(ListClubVideoReviewsFeatureInputSchema) {}
class ListClubVideoReviewsOutput extends createZodDto(ListClubVideoReviewsFeatureOutputSchema) {}
class GetVideoReviewOutput extends createZodDto(GetVideoReviewFeatureOutputSchema) {}
class GetVideoReviewPlaybackOutput extends createZodDto(
    GetVideoReviewPlaybackFeatureOutputSchema,
) {}
class SetVideoReviewStatusInput extends createZodDto(SetVideoReviewStatusFeatureInputSchema) {}
class SetVideoReviewStatusOutput extends createZodDto(SetVideoReviewStatusFeatureOutputSchema) {}
class AddVideoReviewCommentInput extends createZodDto(AddVideoReviewCommentFeatureInputSchema) {}
class UpdateVideoReviewCommentInput extends createZodDto(
    UpdateVideoReviewCommentFeatureInputSchema,
) {}
class VideoReviewCommentOutput extends createZodDto(VideoReviewCommentFeatureOutputSchema) {}

// The club's role for this request (the guards resolved it; the owner is
// 'admin'). Handlers authorise with it via RbacService: which staff may see
// a member's requests, and that the member who sent one reads it.
const viewerRole = (user: CurrentUserPayload): ReviewViewerRole => ({
    roleName: user.role?.name ?? null,
    isSuperAdmin: user.isSuperAdmin,
})

// «Разборы»: one request as its member or the club's staff see it, and the
// staff's work on it. Get / playback / status are open to the member who
// sent it too (checked in the handler).
@Controller('workspaces/:workspaceId/video-reviews')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class VideoReviewsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListClubVideoReviewsOutput })
    async listClubVideoReviews(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListClubVideoReviewsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListClubVideoReviewsFeature,
            ListClubVideoReviewsFeatureResponse
        >(new ListClubVideoReviewsFeature(user.userId, workspaceId, viewerRole(user), query))
    }

    @Get(':requestId')
    @ZodResponse({ type: GetVideoReviewOutput })
    async getVideoReview(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetVideoReviewFeature, GetVideoReviewFeatureResponse>(
            new GetVideoReviewFeature(user.userId, workspaceId, viewerRole(user), requestId),
        )
    }

    @Get(':requestId/playback')
    @ZodResponse({ type: GetVideoReviewPlaybackOutput })
    async getVideoReviewPlayback(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetVideoReviewPlaybackFeature,
            GetVideoReviewPlaybackFeatureResponse
        >(
            new GetVideoReviewPlaybackFeature(
                user.userId,
                workspaceId,
                viewerRole(user),
                requestId,
            ),
        )
    }

    @Put(':requestId/status')
    @ZodResponse({ type: SetVideoReviewStatusOutput })
    async setVideoReviewStatus(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() body: SetVideoReviewStatusInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SetVideoReviewStatusFeature,
            SetVideoReviewStatusFeatureResponse
        >(
            new SetVideoReviewStatusFeature(
                user.userId,
                workspaceId,
                viewerRole(user),
                requestId,
                body,
            ),
        )
    }

    @Post(':requestId/comments')
    @Roles(COACHING_ROLES)
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: VideoReviewCommentOutput })
    async addVideoReviewComment(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() body: AddVideoReviewCommentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddVideoReviewCommentFeature,
            VideoReviewCommentFeatureResponse
        >(
            new AddVideoReviewCommentFeature(
                user.userId,
                workspaceId,
                viewerRole(user),
                requestId,
                body,
            ),
        )
    }

    @Patch(':requestId/comments/:commentId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: VideoReviewCommentOutput })
    async updateVideoReviewComment(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Param('commentId', ParseUUIDPipe) commentId: string,
        @Body() body: UpdateVideoReviewCommentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateVideoReviewCommentFeature,
            VideoReviewCommentFeatureResponse
        >(
            new UpdateVideoReviewCommentFeature(
                user.userId,
                workspaceId,
                viewerRole(user),
                requestId,
                commentId,
                body,
            ),
        )
    }

    @Delete(':requestId/comments/:commentId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: VideoReviewCommentOutput })
    async deleteVideoReviewComment(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Param('commentId', ParseUUIDPipe) commentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteVideoReviewCommentFeature,
            VideoReviewCommentFeatureResponse
        >(
            new DeleteVideoReviewCommentFeature(
                user.userId,
                workspaceId,
                viewerRole(user),
                requestId,
                commentId,
            ),
        )
    }
}
