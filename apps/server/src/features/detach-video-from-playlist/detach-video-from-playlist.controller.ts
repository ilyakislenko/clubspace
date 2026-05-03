import { Controller, Delete, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    DetachVideoFromPlaylistFeature,
    DetachVideoFromPlaylistFeatureOutputSchema,
    DetachVideoFromPlaylistFeatureResponse,
} from './detach-video-from-playlist.feature'

class DetachVideoFromPlaylistOutput extends createZodDto(
    DetachVideoFromPlaylistFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class DetachVideoFromPlaylistController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':playlistId/videos/:videoId')
    @ZodResponse({ type: DetachVideoFromPlaylistOutput })
    async detach(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Param('videoId') videoId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DetachVideoFromPlaylistFeature,
            DetachVideoFromPlaylistFeatureResponse
        >(
            new DetachVideoFromPlaylistFeature(
                workspaceId,
                playlistId,
                videoId,
                user.userId,
            ),
        )
    }
}
