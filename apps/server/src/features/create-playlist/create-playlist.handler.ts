import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
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
        private readonly realtime: RealtimeEmitter,
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

        // Nudge every open course list (members' home screens) to refetch. We
        // invalidate rather than compute a visibility delta — a course can be
        // created already-published, and drafts stay hidden by the list's own
        // publishedAt filter, so a broad refetch is correct and cheap.
        this.realtime.invalidate(workspaceId, ['courses'])

        return result
    }
}
