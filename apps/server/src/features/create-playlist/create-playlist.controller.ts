import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreatePlaylistFeature,
    CreatePlaylistFeatureInputSchema,
    CreatePlaylistFeatureOutputSchema,
    CreatePlaylistFeatureResponse,
} from './create-playlist.feature'

class CreatePlaylistInput extends createZodDto(
    CreatePlaylistFeatureInputSchema,
) {}

class CreatePlaylistOutput extends createZodDto(
    CreatePlaylistFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class CreatePlaylistController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: CreatePlaylistOutput })
    async createPlaylist(
        @Param('workspaceId') workspaceId: string,
        @Body() input: CreatePlaylistInput,
    ) {
        return await this.bus.execute<
            CreatePlaylistFeature,
            CreatePlaylistFeatureResponse
        >(new CreatePlaylistFeature(input, workspaceId))
    }
}
