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
    UpdatePlaylistChapterFeature,
    UpdatePlaylistChapterFeatureInputSchema,
    UpdatePlaylistChapterFeatureOutputSchema,
    UpdatePlaylistChapterFeatureResponse,
} from './update-playlist-chapter.feature'

class UpdatePlaylistChapterBody extends createZodDto(
    UpdatePlaylistChapterFeatureInputSchema,
) {}

class UpdatePlaylistChapterOutput extends createZodDto(
    UpdatePlaylistChapterFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class UpdatePlaylistChapterController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':playlistId/chapters/:chapterId')
    @ZodResponse({ type: UpdatePlaylistChapterOutput })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Param('chapterId') chapterId: string,
        @Body() body: UpdatePlaylistChapterBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlaylistChapterFeature,
            UpdatePlaylistChapterFeatureResponse
        >(
            new UpdatePlaylistChapterFeature(
                body,
                workspaceId,
                playlistId,
                chapterId,
                user.userId,
            ),
        )
    }
}
