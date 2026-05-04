import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    UpdatePlaylistChapterFeature,
    UpdatePlaylistChapterFeatureResponse,
} from './update-playlist-chapter.feature'

@Feature(UpdatePlaylistChapterFeature)
export class UpdatePlaylistChapterHandler
    implements
        IFeatureHandler<
            UpdatePlaylistChapterFeature,
            UpdatePlaylistChapterFeatureResponse
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
    }: UpdatePlaylistChapterFeature) {
        const result = await this.playlistService.updateChapter({
            workspaceId,
            playlistId,
            chapterId,
            data: { title: payload.title },
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { renamedChapter: chapterId, title: result.title },
        })

        return result
    }
}
