import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
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
    SearchVideosFeature,
    SearchVideosFeatureInputSchema,
    SearchVideosFeatureOutputSchema,
    SearchVideosFeatureResponse,
} from './search-videos.feature'

class SearchVideosQuery extends createZodDto(SearchVideosFeatureInputSchema) {}

class SearchVideosOutput extends createZodDto(SearchVideosFeatureOutputSchema) {}

// Registered before GetWorkspaceVideoController in app.module, so
// `videos/search` isn't taken for a `videos/:videoId`.
@Controller('workspaces/:workspaceId/videos/search')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class SearchVideosController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: SearchVideosOutput })
    async searchVideos(
        @Param('workspaceId') workspaceId: string,
        @Query() query: SearchVideosQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        const isStaff =
            user.isSuperAdmin ||
            (user.role
                ? STAFF_ROLES.includes(user.role.name as (typeof STAFF_ROLES)[number])
                : false)
        return await this.bus.execute<SearchVideosFeature, SearchVideosFeatureResponse>(
            new SearchVideosFeature(user.userId, workspaceId, query, isStaff),
        )
    }
}
