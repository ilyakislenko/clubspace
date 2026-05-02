import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    MovePlaylistVideoFeature,
    MovePlaylistVideoFeatureInputSchema,
    MovePlaylistVideoFeatureOutputSchema,
    MovePlaylistVideoFeatureResponse,
} from './move-playlist-video.feature'

class MovePlaylistVideoBody extends createZodDto(
    MovePlaylistVideoFeatureInputSchema,
) {}

class MovePlaylistVideoOutput extends createZodDto(
    MovePlaylistVideoFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class MovePlaylistVideoController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':playlistId/videos/:videoId/position')
    @ZodResponse({ type: MovePlaylistVideoOutput })
    async move(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Param('videoId') videoId: string,
        @Body() body: MovePlaylistVideoBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            MovePlaylistVideoFeature,
            MovePlaylistVideoFeatureResponse
        >(
            new MovePlaylistVideoFeature(
                body,
                workspaceId,
                playlistId,
                videoId,
                user.userId,
            ),
        )
    }
}
