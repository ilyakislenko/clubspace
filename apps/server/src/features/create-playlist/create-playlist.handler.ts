import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    CreatePlaylistFeature,
    CreatePlaylistFeatureResponse,
} from './create-playlist.feature'

@Feature(CreatePlaylistFeature)
export class CreatePlaylistHandler
    implements
        IFeatureHandler<CreatePlaylistFeature, CreatePlaylistFeatureResponse>
{
    constructor(private readonly playlistService: PlaylistService) {}

    async execute({ payload, workspaceId }: CreatePlaylistFeature) {
        return await this.playlistService.createPlaylist({
            workspaceId,
            data: payload,
        })
    }
}
