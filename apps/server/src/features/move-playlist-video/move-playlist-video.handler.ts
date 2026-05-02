import { Feature, IFeatureHandler } from '@shelfjs/features'
import { generateKeyBetween } from 'fractional-indexing'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    MovePlaylistVideoFeature,
    MovePlaylistVideoFeatureResponse,
} from './move-playlist-video.feature'

@Feature(MovePlaylistVideoFeature)
export class MovePlaylistVideoHandler
    implements
        IFeatureHandler<
            MovePlaylistVideoFeature,
            MovePlaylistVideoFeatureResponse
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
        videoId,
        invokerUserId,
    }: MovePlaylistVideoFeature) {
        const playlist = await this.prisma.course.findFirst({
            where: { id: playlistId, workspaceId },
            select: { id: true },
        })

        if (!playlist) {
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        const moving = await this.prisma.courseVideo.findUnique({
            where: { courseId_videoId: { courseId: playlistId, videoId } },
            select: { videoId: true },
        })
        if (!moving) {
            throw new NotFoundError({
                message: 'Video is not attached to this playlist',
            })
        }

        // Resolve neighbour keys (if provided). Both must exist in this playlist
        // and must not be the moving video itself.
        const resolveNeighbour = async (
            id: string | null | undefined,
        ): Promise<string | null> => {
            if (id === undefined) return null
            if (id === null) return null
            if (id === videoId) {
                throw new BadRequestError({
                    message:
                        'Neighbour cannot be the same as the video being moved',
                })
            }
            const row = await this.prisma.courseVideo.findUnique({
                where: { courseId_videoId: { courseId: playlistId, videoId: id } },
                select: { order: true },
            })
            if (!row) {
                throw new BadRequestError({
                    message: 'Neighbour video is not in this playlist',
                })
            }
            return row.order
        }

        const [afterKey, beforeKey] = await Promise.all([
            resolveNeighbour(payload.afterId ?? null),
            resolveNeighbour(payload.beforeId ?? null),
        ])

        // If both neighbours are unspecified, the request is meaningless;
        // the schema-level refine already enforces this, but be explicit.
        if (
            payload.afterId === undefined &&
            payload.beforeId === undefined
        ) {
            throw new BadRequestError({
                message: 'Provide afterId, beforeId, or both',
            })
        }

        let nextKey: string
        try {
            nextKey = generateKeyBetween(afterKey, beforeKey)
        } catch (error) {
            throw new BadRequestError({
                message:
                    error instanceof Error
                        ? error.message
                        : 'Cannot place between the given videos',
            })
        }

        await this.prisma.courseVideo.update({
            where: { courseId_videoId: { courseId: playlistId, videoId } },
            data: { order: nextKey },
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                movedVideo: videoId,
                afterId: payload.afterId ?? null,
                beforeId: payload.beforeId ?? null,
            },
        })

        return { videoId, order: nextKey }
    }
}
