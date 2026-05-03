import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    DetachVideoFromPlaylistFeature,
    DetachVideoFromPlaylistFeatureResponse,
} from './detach-video-from-playlist.feature'

@Feature(DetachVideoFromPlaylistFeature)
export class DetachVideoFromPlaylistHandler
    implements
        IFeatureHandler<
            DetachVideoFromPlaylistFeature,
            DetachVideoFromPlaylistFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        workspaceId,
        playlistId,
        videoId,
        invokerUserId,
    }: DetachVideoFromPlaylistFeature) {
        const playlist = await this.prisma.course.findFirst({
            where: { id: playlistId, workspaceId },
            select: { id: true },
        })

        if (!playlist) {
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        const link = await this.prisma.courseVideo.findUnique({
            where: {
                courseId_videoId: { courseId: playlistId, videoId },
            },
            select: { courseId: true },
        })

        if (!link) {
            throw new NotFoundError({
                message: 'Video is not attached to this playlist',
            })
        }

        await this.prisma.courseVideo.delete({
            where: {
                courseId_videoId: { courseId: playlistId, videoId },
            },
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { removedVideo: videoId },
        })

        return { status: 'removed' as const }
    }
}
