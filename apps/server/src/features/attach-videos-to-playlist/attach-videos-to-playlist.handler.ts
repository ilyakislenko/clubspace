import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    AttachVideosToPlaylistFeature,
    AttachVideosToPlaylistFeatureResponse,
} from './attach-videos-to-playlist.feature'

@Feature(AttachVideosToPlaylistFeature)
export class AttachVideosToPlaylistHandler
    implements
        IFeatureHandler<
            AttachVideosToPlaylistFeature,
            AttachVideosToPlaylistFeatureResponse
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
    }: AttachVideosToPlaylistFeature) {
        const playlist = await this.prisma.course.findFirst({
            where: { id: playlistId, workspaceId },
            select: { id: true },
        })

        if (!playlist) {
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        // Verify all videos belong to the same workspace.
        const videos = await this.prisma.video.findMany({
            where: {
                id: { in: payload.videoIds },
                workspaceId,
            },
            select: { id: true },
        })
        const validIds = new Set(videos.map((v) => v.id))
        const invalid = payload.videoIds.filter((id) => !validIds.has(id))
        if (invalid.length) {
            throw new BadRequestError({
                message: `Some videos do not belong to this workspace`,
            })
        }

        // Drop ones that already attached.
        const existing = await this.prisma.courseVideo.findMany({
            where: {
                courseId: playlistId,
                videoId: { in: payload.videoIds },
            },
            select: { videoId: true },
        })
        const alreadyIn = new Set(existing.map((row) => row.videoId))
        const toAdd = payload.videoIds.filter((id) => !alreadyIn.has(id))
        const skipped = payload.videoIds.length - toAdd.length

        if (toAdd.length === 0) {
            return { added: 0, skipped }
        }

        // Append after the current max order so existing ordering is preserved.
        const maxOrder = await this.prisma.courseVideo.aggregate({
            where: { courseId: playlistId },
            _max: { order: true },
        })
        const startOrder = (maxOrder._max.order ?? 0) + 1

        await this.prisma.courseVideo.createMany({
            data: toAdd.map((videoId, index) => ({
                courseId: playlistId,
                videoId,
                order: startOrder + index,
            })),
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { addedVideos: toAdd },
        })

        return { added: toAdd.length, skipped }
    }
}
