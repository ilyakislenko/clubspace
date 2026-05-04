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
    DeletePlaylistChapterFeature,
    DeletePlaylistChapterFeatureOutputSchema,
    DeletePlaylistChapterFeatureResponse,
} from './delete-playlist-chapter.feature'

class DeletePlaylistChapterOutput extends createZodDto(
    DeletePlaylistChapterFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class DeletePlaylistChapterController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':playlistId/chapters/:chapterId')
    @ZodResponse({ type: DeletePlaylistChapterOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Param('chapterId') chapterId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeletePlaylistChapterFeature,
            DeletePlaylistChapterFeatureResponse
        >(
            new DeletePlaylistChapterFeature(
                workspaceId,
                playlistId,
                chapterId,
                user.userId,
            ),
        )
    }
}
