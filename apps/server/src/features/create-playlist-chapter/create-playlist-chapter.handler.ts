import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    CreatePlaylistChapterFeature,
    CreatePlaylistChapterFeatureResponse,
} from './create-playlist-chapter.feature'

@Feature(CreatePlaylistChapterFeature)
export class CreatePlaylistChapterHandler
    implements
        IFeatureHandler<
            CreatePlaylistChapterFeature,
            CreatePlaylistChapterFeatureResponse
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
        invokerUserId,
    }: CreatePlaylistChapterFeature) {
        const result = await this.playlistService.createChapter({
            workspaceId,
            playlistId,
            title: payload.title,
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { createdChapter: result.id, title: result.title },
        })

        return result
    }
}
