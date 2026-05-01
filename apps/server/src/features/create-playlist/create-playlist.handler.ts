import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    CreatePlaylistFeature,
    CreatePlaylistFeatureResponse,
} from './create-playlist.feature'

@Feature(CreatePlaylistFeature)
export class CreatePlaylistHandler
    implements
        IFeatureHandler<CreatePlaylistFeature, CreatePlaylistFeatureResponse>
{
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: CreatePlaylistFeature) {
        const result = await this.playlistService.createPlaylist({
            workspaceId,
            data: payload,
        })

        await this.audit.record({
            action: 'playlist.create',
            targetType: 'playlist',
            targetId: result.id,
            workspaceId,
            actorId: invokerUserId,
            metadata: { title: payload.title, slug: payload.slug },
        })

        return result
    }
}
