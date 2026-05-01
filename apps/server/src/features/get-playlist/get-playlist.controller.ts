import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

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
    ) {
        return await this.bus.execute<
            GetPlaylistFeature,
            GetPlaylistFeatureResponse
        >(new GetPlaylistFeature(workspaceId, playlistId))
    }
}
