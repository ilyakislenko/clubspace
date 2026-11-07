import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CompleteMyVideoReviewUploadFeature,
    CompleteMyVideoReviewUploadFeatureOutputSchema,
    CompleteMyVideoReviewUploadFeatureResponse,
} from './complete-my-video-review-upload.feature'
import {
    CreateMyVideoReviewFeature,
    CreateMyVideoReviewFeatureInputSchema,
    CreateMyVideoReviewFeatureOutputSchema,
    CreateMyVideoReviewFeatureResponse,
} from './create-my-video-review.feature'
import {
    DeleteMyVideoReviewFeature,
    DeleteMyVideoReviewFeatureOutputSchema,
    DeleteMyVideoReviewFeatureResponse,
} from './delete-my-video-review.feature'
import {
    ListMyVideoReviewsFeature,
    ListMyVideoReviewsFeatureOutputSchema,
    ListMyVideoReviewsFeatureResponse,
} from './list-my-video-reviews.feature'

class ListMyVideoReviewsOutput extends createZodDto(ListMyVideoReviewsFeatureOutputSchema) {}
class CreateMyVideoReviewInput extends createZodDto(CreateMyVideoReviewFeatureInputSchema) {}
class CreateMyVideoReviewOutput extends createZodDto(CreateMyVideoReviewFeatureOutputSchema) {}
class CompleteMyVideoReviewUploadOutput extends createZodDto(
    CompleteMyVideoReviewUploadFeatureOutputSchema,
) {}
class DeleteMyVideoReviewOutput extends createZodDto(DeleteMyVideoReviewFeatureOutputSchema) {}

// «Мои разборы»: the member's own review requests in this club. Workspace
// member routes (a guardian's X-Act-As works); each handler checks the member
// owns the request.
@Controller('workspaces/:workspaceId/me/video-reviews')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class MyVideoReviewsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyVideoReviewsOutput })
    async listMyVideoReviews(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListMyVideoReviewsFeature, ListMyVideoReviewsFeatureResponse>(
            new ListMyVideoReviewsFeature(user.userId, workspaceId),
        )
    }

    @Post()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: CreateMyVideoReviewOutput })
    async createMyVideoReview(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateMyVideoReviewInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateMyVideoReviewFeature,
            CreateMyVideoReviewFeatureResponse
        >(new CreateMyVideoReviewFeature(user.userId, workspaceId, body))
    }

    @Post(':requestId/complete')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: CompleteMyVideoReviewUploadOutput })
    async completeMyVideoReviewUpload(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CompleteMyVideoReviewUploadFeature,
            CompleteMyVideoReviewUploadFeatureResponse
        >(new CompleteMyVideoReviewUploadFeature(user.userId, workspaceId, requestId))
    }

    @Delete(':requestId')
    @ZodResponse({ type: DeleteMyVideoReviewOutput })
    async deleteMyVideoReview(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteMyVideoReviewFeature,
            DeleteMyVideoReviewFeatureResponse
        >(new DeleteMyVideoReviewFeature(user.userId, workspaceId, requestId))
    }
}
