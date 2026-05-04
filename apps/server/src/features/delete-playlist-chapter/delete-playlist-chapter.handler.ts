import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    DeletePlaylistChapterFeature,
    DeletePlaylistChapterFeatureResponse,
} from './delete-playlist-chapter.feature'

@Feature(DeletePlaylistChapterFeature)
export class DeletePlaylistChapterHandler
    implements
        IFeatureHandler<
            DeletePlaylistChapterFeature,
            DeletePlaylistChapterFeatureResponse
        >
{
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        workspaceId,
        playlistId,
        chapterId,
        invokerUserId,
    }: DeletePlaylistChapterFeature) {
        await this.playlistService.deleteChapter({
            workspaceId,
            playlistId,
            chapterId,
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { deletedChapter: chapterId },
        })

        return { status: 'deleted' as const }
    }
}
