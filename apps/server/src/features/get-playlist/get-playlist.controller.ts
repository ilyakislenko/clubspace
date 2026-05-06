import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetPlaylistFeature,
    GetPlaylistFeatureOutputSchema,
    GetPlaylistFeatureResponse,
} from './get-playlist.feature'

class GetPlaylistOutput extends createZodDto(GetPlaylistFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GetPlaylistController {
    constructor(private bus: FeaturesBus) {}

    @Get(':playlistId')
    @ZodResponse({ type: GetPlaylistOutput })
    async getPlaylist(
        @Param('workspaceId') workspaceId: string,
        @Param('playlistId') playlistId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        const isStaff =
            user.isSuperAdmin ||
            (user.role
                ? STAFF_ROLES.includes(user.role.name as (typeof STAFF_ROLES)[number])
                : false)
        return await this.bus.execute<
            GetPlaylistFeature,
            GetPlaylistFeatureResponse
        >(new GetPlaylistFeature(workspaceId, playlistId, isStaff))
    }
}
