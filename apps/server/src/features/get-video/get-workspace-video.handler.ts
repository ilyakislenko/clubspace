import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { VideoService } from '../../domains/video/services/video.service'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetWorkspaceVideoFeature,
    GetWorkspaceVideoFeatureResponse,
} from './get-workspace-video.feature'

@Feature(GetWorkspaceVideoFeature)
export class GetWorkspaceVideoHandler
    implements
        IFeatureHandler<
            GetWorkspaceVideoFeature,
            GetWorkspaceVideoFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
        private readonly videoService: VideoService,
    ) {}

    async execute({
        workspaceId,
        videoId,
        invokerUserId,
    }: GetWorkspaceVideoFeature) {
        const video = await this.prisma.video.findFirst({
            where: { id: videoId, workspaceId },
            select: { id: true, workspaceId: true },
        })
        if (!video) {
            throw new NotFoundError({ message: 'Видео не найдено' })
        }

        const access = await this.courseAccess.assertCanWatchVideo(
            video,
            invokerUserId,
        )
        const detail = await this.videoService.getVideo({ videoId, workspaceId })
        if (access.visibleCourseIds === null) return detail

        // A student must not learn the titles of courses hidden from them.
        const visible = new Set(access.visibleCourseIds)
        return {
            ...detail,
            playlists: detail.playlists.filter((p) => visible.has(p.id)),
        }
    }
}
