import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
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
    UpdatePlaylistFeature,
    UpdatePlaylistFeatureInputSchema,
    UpdatePlaylistFeatureOutputSchema,
    UpdatePlaylistFeatureResponse,
} from './update-playlist.feature'

class UpdatePlaylistInput extends createZodDto(
    UpdatePlaylistFeatureInputSchema,
) {}

class UpdatePlaylistOutput extends createZodDto(
    UpdatePlaylistFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class UpdatePlaylistController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':playlistId')
    @ZodResponse({ type: UpdatePlaylistOutput })
    async updatePlaylist(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @Body() input: UpdatePlaylistInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlaylistFeature,
            UpdatePlaylistFeatureResponse
        >(
            new UpdatePlaylistFeature(input, workspaceId, playlistId, user.userId),
        )
    }
}
