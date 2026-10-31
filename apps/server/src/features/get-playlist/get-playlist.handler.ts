import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import {
    GetPlaylistFeature,
    GetPlaylistFeatureResponse,
} from './get-playlist.feature'

@Feature(GetPlaylistFeature)
export class GetPlaylistHandler
    implements IFeatureHandler<GetPlaylistFeature, GetPlaylistFeatureResponse>
{
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute({
        workspaceId,
        playlistId,
        invokerUserId,
        isStaff,
    }: GetPlaylistFeature) {
        const viewer = await this.courseAccess.loadViewer({
            workspaceId,
            userId: invokerUserId,
            isStaff,
        })
        return await this.playlistService.getPlaylist({
            workspaceId,
            playlistId,
            viewer,
            userId: invokerUserId,
        })
    }
}
