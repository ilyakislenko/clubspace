import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    MovePlaylistChapterFeature,
    MovePlaylistChapterFeatureResponse,
} from './move-playlist-chapter.feature'

@Feature(MovePlaylistChapterFeature)
export class MovePlaylistChapterHandler
    implements
        IFeatureHandler<
            MovePlaylistChapterFeature,
            MovePlaylistChapterFeatureResponse
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
        chapterId,
        invokerUserId,
    }: MovePlaylistChapterFeature) {
        const result = await this.playlistService.moveChapter({
            workspaceId,
            playlistId,
            chapterId,
            afterChapterId: payload.afterChapterId,
            beforeChapterId: payload.beforeChapterId,
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                movedChapter: chapterId,
                afterChapterId: payload.afterChapterId ?? null,
                beforeChapterId: payload.beforeChapterId ?? null,
            },
        })

        return result
    }
}
