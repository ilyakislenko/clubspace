import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
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
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        workspaceId,
        playlistId,
        invokerUserId,
    }: DeletePlaylistFeature) {
        await this.playlistService.deletePlaylist({ workspaceId, playlistId })

        await this.audit.record({
            action: 'playlist.delete',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
        })

        return { status: 'deleted' as const }
    }
}
