import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    CreatePlaylistThumbnailUploadFeature,
    CreatePlaylistThumbnailUploadFeatureResponse,
} from './create-playlist-thumbnail-upload.feature'

@Feature(CreatePlaylistThumbnailUploadFeature)
export class CreatePlaylistThumbnailUploadHandler
    implements
        IFeatureHandler<
            CreatePlaylistThumbnailUploadFeature,
            CreatePlaylistThumbnailUploadFeatureResponse
        >
{
    constructor(private readonly playlistService: PlaylistService) {}

    async execute({
        payload,
        workspaceId,
        playlistId,
    }: CreatePlaylistThumbnailUploadFeature) {
        return await this.playlistService.createThumbnailUpload({
            workspaceId,
            playlistId,
            contentType: payload.contentType,
        })
    }
}
