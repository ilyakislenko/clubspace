import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
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
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly audit: AuditService,
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

        return result
    }
}
