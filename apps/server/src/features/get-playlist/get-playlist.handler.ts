import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    GetPlaylistFeature,
    GetPlaylistFeatureResponse,
} from './get-playlist.feature'

@Feature(GetPlaylistFeature)
export class GetPlaylistHandler
    implements IFeatureHandler<GetPlaylistFeature, GetPlaylistFeatureResponse>
{
    constructor(private readonly playlistService: PlaylistService) {}

    async execute({ workspaceId, playlistId }: GetPlaylistFeature) {
        return await this.playlistService.getPlaylist({
            workspaceId,
            playlistId,
        })
    }
}
