import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreatePlaylistChapterFeature,
    CreatePlaylistChapterFeatureInputSchema,
    CreatePlaylistChapterFeatureOutputSchema,
    CreatePlaylistChapterFeatureResponse,
} from './create-playlist-chapter.feature'

class CreatePlaylistChapterBody extends createZodDto(
    CreatePlaylistChapterFeatureInputSchema,
) {}

class CreatePlaylistChapterOutput extends createZodDto(
    CreatePlaylistChapterFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class CreatePlaylistChapterController {
    constructor(private bus: FeaturesBus) {}

    @Post(':playlistId/chapters')
    @ZodResponse({ type: CreatePlaylistChapterOutput })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Body() body: CreatePlaylistChapterBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreatePlaylistChapterFeature,
            CreatePlaylistChapterFeatureResponse
        >(
            new CreatePlaylistChapterFeature(
                body,
                workspaceId,
                playlistId,
                user.userId,
            ),
        )
    }
}
