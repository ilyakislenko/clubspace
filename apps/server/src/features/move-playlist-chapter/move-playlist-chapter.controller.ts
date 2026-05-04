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
    MovePlaylistChapterFeature,
    MovePlaylistChapterFeatureInputSchema,
    MovePlaylistChapterFeatureOutputSchema,
    MovePlaylistChapterFeatureResponse,
} from './move-playlist-chapter.feature'

class MovePlaylistChapterBody extends createZodDto(
    MovePlaylistChapterFeatureInputSchema,
) {}

class MovePlaylistChapterOutput extends createZodDto(
    MovePlaylistChapterFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class MovePlaylistChapterController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':playlistId/chapters/:chapterId/position')
    @ZodResponse({ type: MovePlaylistChapterOutput })
    async move(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Param('chapterId') chapterId: string,
        @Body() body: MovePlaylistChapterBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            MovePlaylistChapterFeature,
            MovePlaylistChapterFeatureResponse
        >(
            new MovePlaylistChapterFeature(
                body,
                workspaceId,
                playlistId,
                chapterId,
                user.userId,
            ),
        )
    }
}
