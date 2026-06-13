import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AttachVideosToPlaylistFeature,
    AttachVideosToPlaylistFeatureInputSchema,
    AttachVideosToPlaylistFeatureOutputSchema,
    AttachVideosToPlaylistFeatureResponse,
} from './attach-videos-to-playlist.feature'

class AttachVideosToPlaylistBody extends createZodDto(
    AttachVideosToPlaylistFeatureInputSchema,
) {}

class AttachVideosToPlaylistOutput extends createZodDto(
    AttachVideosToPlaylistFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class AttachVideosToPlaylistController {
    constructor(private bus: FeaturesBus) {}

    @Post(':playlistId/videos')
    @ZodResponse({ type: AttachVideosToPlaylistOutput })
    async attach(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Body() body: AttachVideosToPlaylistBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AttachVideosToPlaylistFeature,
            AttachVideosToPlaylistFeatureResponse
        >(
            new AttachVideosToPlaylistFeature(
                body,
                workspaceId,
                playlistId,
                user.userId,
            ),
        )
    }
}
