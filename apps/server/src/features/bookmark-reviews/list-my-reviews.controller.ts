import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListMyReviewsFeature,
    ListMyReviewsFeatureOutputSchema,
    ListMyReviewsFeatureResponse,
} from './list-my-reviews.feature'

class ListMyReviewsOutput extends createZodDto(
    ListMyReviewsFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/me/reviews')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListMyReviewsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyReviewsOutput })
    async listMyReviews(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        const isStaff =
            user.isSuperAdmin ||
            (user.role
                ? STAFF_ROLES.includes(user.role.name as (typeof STAFF_ROLES)[number])
                : false)
        return await this.bus.execute<
            ListMyReviewsFeature,
            ListMyReviewsFeatureResponse
        >(new ListMyReviewsFeature(user.userId, workspaceId, isStaff))
    }
}
