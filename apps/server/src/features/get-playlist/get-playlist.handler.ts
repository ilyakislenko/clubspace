import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VIDEO_UNAVAILABLE_FOR_MEMBERS } from '../../domains/billing/module-entitlement'
import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { ModuleNotEntitledError } from '../../shared/errors/shared.errors'
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
        if (
            !isStaff &&
            !(await this.courseAccess.videosOpenToMembers(workspaceId))
        ) {
            throw new ModuleNotEntitledError({
                module: 'VIDEO',
                message: VIDEO_UNAVAILABLE_FOR_MEMBERS,
            })
        }
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
