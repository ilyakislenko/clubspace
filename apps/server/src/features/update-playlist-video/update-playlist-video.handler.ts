import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    UpdatePlaylistVideoFeature,
    UpdatePlaylistVideoFeatureResponse,
} from './update-playlist-video.feature'

@Feature(UpdatePlaylistVideoFeature)
export class UpdatePlaylistVideoHandler
    implements
        IFeatureHandler<
            UpdatePlaylistVideoFeature,
            UpdatePlaylistVideoFeatureResponse
        >
{
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        playlistId,
        videoId,
        invokerUserId,
    }: UpdatePlaylistVideoFeature) {
        const result = await this.playlistService.updatePlaylistVideo({
            workspaceId,
            playlistId,
            videoId,
            data: { chapterTitle: payload.chapterTitle },
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                updatedVideo: videoId,
                chapterTitle: result.chapterTitle,
            },
        })

        return result
    }
}
