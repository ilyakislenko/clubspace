import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    ListPlaylistsFeature,
    ListPlaylistsFeatureResponse,
} from './list-playlists.feature'

@Feature(ListPlaylistsFeature)
export class ListPlaylistsHandler
    implements
        IFeatureHandler<ListPlaylistsFeature, ListPlaylistsFeatureResponse>
{
    constructor(private readonly playlistService: PlaylistService) {}

    async execute({ payload, workspaceId }: ListPlaylistsFeature) {
        return await this.playlistService.listPlaylists({
            workspaceId,
            curPage: payload.curPage,
            perPage: payload.perPage,
        })
    }
}
