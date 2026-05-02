import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ReorderPlaylistVideosFeature,
    ReorderPlaylistVideosFeatureInputSchema,
    ReorderPlaylistVideosFeatureOutputSchema,
    ReorderPlaylistVideosFeatureResponse,
} from './reorder-playlist-videos.feature'

class ReorderPlaylistVideosBody extends createZodDto(
    ReorderPlaylistVideosFeatureInputSchema,
) {}

class ReorderPlaylistVideosOutput extends createZodDto(
    ReorderPlaylistVideosFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ReorderPlaylistVideosController {
    constructor(private bus: FeaturesBus) {}

    @Put(':playlistId/videos/order')
    @ZodResponse({ type: ReorderPlaylistVideosOutput })
    async reorder(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Body() body: ReorderPlaylistVideosBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ReorderPlaylistVideosFeature,
            ReorderPlaylistVideosFeatureResponse
        >(
            new ReorderPlaylistVideosFeature(
                body,
                workspaceId,
                playlistId,
                user.userId,
            ),
        )
    }
}
