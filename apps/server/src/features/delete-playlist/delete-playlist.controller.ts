import { Controller, Delete, Param, UseGuards } from '@nestjs/common'
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
    DeletePlaylistFeature,
    DeletePlaylistFeatureOutputSchema,
    DeletePlaylistFeatureResponse,
} from './delete-playlist.feature'

class DeletePlaylistOutput extends createZodDto(
    DeletePlaylistFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class DeletePlaylistController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':playlistId')
    @ZodResponse({ type: DeletePlaylistOutput })
    async deletePlaylist(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeletePlaylistFeature,
            DeletePlaylistFeatureResponse
        >(new DeletePlaylistFeature(workspaceId, playlistId, user.userId))
    }
}
