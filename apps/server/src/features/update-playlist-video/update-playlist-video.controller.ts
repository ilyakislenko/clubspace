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
    UpdatePlaylistVideoFeature,
    UpdatePlaylistVideoFeatureInputSchema,
    UpdatePlaylistVideoFeatureOutputSchema,
    UpdatePlaylistVideoFeatureResponse,
} from './update-playlist-video.feature'

class UpdatePlaylistVideoBody extends createZodDto(
    UpdatePlaylistVideoFeatureInputSchema,
) {}

class UpdatePlaylistVideoOutput extends createZodDto(
    UpdatePlaylistVideoFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class UpdatePlaylistVideoController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':playlistId/videos/:videoId')
    @ZodResponse({ type: UpdatePlaylistVideoOutput })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Param('videoId') videoId: string,
        @Body() body: UpdatePlaylistVideoBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlaylistVideoFeature,
            UpdatePlaylistVideoFeatureResponse
        >(
            new UpdatePlaylistVideoFeature(
                body,
                workspaceId,
                playlistId,
                videoId,
                user.userId,
            ),
        )
    }
}
