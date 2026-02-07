import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    UpdatePlaylistFeature,
    UpdatePlaylistFeatureResponse,
} from './update-playlist.feature'

@Feature(UpdatePlaylistFeature)
export class UpdatePlaylistHandler
    implements
        IFeatureHandler<UpdatePlaylistFeature, UpdatePlaylistFeatureResponse>
{
    constructor(private readonly playlistService: PlaylistService) {}

    async execute({ payload, workspaceId, playlistId }: UpdatePlaylistFeature) {
        return await this.playlistService.updatePlaylist({
            workspaceId,
            playlistId,
            data: payload,
        })
    }
}
