import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import {
    UpdatePlaylistFeature,
    UpdatePlaylistFeatureResponse,
} from './update-playlist.feature'

@Feature(UpdatePlaylistFeature)
export class UpdatePlaylistHandler
    implements
        IFeatureHandler<UpdatePlaylistFeature, UpdatePlaylistFeatureResponse>
{
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        workspaceId,
        playlistId,
        invokerUserId,
    }: UpdatePlaylistFeature) {
        const result = await this.playlistService.updatePlaylist({
            workspaceId,
            playlistId,
            data: payload,
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { fields: Object.keys(payload) },
        })

        // Publishing (setting publishedAt) and edits to a visible course's card
        // both flow through here — refetch every open course list so members
        // see the change without reopening the screen.
        this.realtime.invalidate(workspaceId, ['courses'])

        return result
    }
}
