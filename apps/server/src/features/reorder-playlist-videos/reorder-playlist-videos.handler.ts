import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    ReorderPlaylistVideosFeature,
    ReorderPlaylistVideosFeatureResponse,
} from './reorder-playlist-videos.feature'

@Feature(ReorderPlaylistVideosFeature)
export class ReorderPlaylistVideosHandler
    implements
        IFeatureHandler<
            ReorderPlaylistVideosFeature,
            ReorderPlaylistVideosFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        playlistId,
        invokerUserId,
    }: ReorderPlaylistVideosFeature) {
        const playlist = await this.prisma.course.findFirst({
            where: { id: playlistId, workspaceId },
            select: { id: true },
        })

        if (!playlist) {
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        const existing = await this.prisma.courseVideo.findMany({
            where: { courseId: playlistId },
            select: { videoId: true },
        })

        const existingIds = new Set(existing.map((row) => row.videoId))
        const requestedIds = new Set(payload.videoIds)

        if (
            existingIds.size !== requestedIds.size ||
            payload.videoIds.some((id) => !existingIds.has(id))
        ) {
            throw new BadRequestError({
                message:
                    'Provided list must contain exactly the videos currently attached to this playlist',
            })
        }

        // Two-phase update: bump everything to large negative-style temp values
        // first to avoid violating the (courseId, videoId) primary key when we
        // shuffle. CourseVideo's PK is composite (no `order` uniqueness), so
        // simple sequential updates work, but we still wrap in a transaction.
        await this.prisma.$transaction(
            payload.videoIds.map((videoId, index) =>
                this.prisma.courseVideo.update({
                    where: {
                        courseId_videoId: {
                            courseId: playlistId,
                            videoId,
                        },
                    },
                    data: { order: index + 1 },
                }),
            ),
        )

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { reorderedVideos: payload.videoIds },
        })

        return { status: 'reordered' as const, total: payload.videoIds.length }
    }
}
