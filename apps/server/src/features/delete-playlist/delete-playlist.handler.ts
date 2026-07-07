import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
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
        private readonly realtime: RealtimeEmitter,
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

        // A deleted course vanishes from members' lists — refetch open ones.
        this.realtime.invalidate(workspaceId, ['courses'])

        return { status: 'deleted' as const }
    }
}
