import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    DeletePlaylistFeature,
    DeletePlaylistFeatureResponse,
} from './delete-playlist.feature'

@Feature(DeletePlaylistFeature)
export class DeletePlaylistHandler
    implements
        IFeatureHandler<DeletePlaylistFeature, DeletePlaylistFeatureResponse>
{
    constructor(private readonly playlistService: PlaylistService) {}

    async execute({ workspaceId, playlistId }: DeletePlaylistFeature) {
        await this.playlistService.deletePlaylist({ workspaceId, playlistId })
        return { status: 'deleted' as const }
    }
}
