import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { reorderIds } from '../../shared/utils/reorder'
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
        if (
            payload.afterId === undefined &&
            payload.beforeId === undefined
        ) {
            throw new BadRequestError({
                message: 'Provide afterId, beforeId, or both',
            })
        }

        const playlist = await this.prisma.course.findFirst({
            where: { id: playlistId, workspaceId },
            select: { id: true },
        })

        if (!playlist) {
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        const newOrder = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.courseVideo.findMany({
                where: { courseId: playlistId },
                orderBy: [{ order: 'asc' }, { videoId: 'asc' }],
                select: { videoId: true },
            })

            const movingIdx = rows.findIndex((r) => r.videoId === videoId)
            if (movingIdx === -1) {
                throw new NotFoundError({
                    message: 'Video is not attached to this playlist',
                })
            }

            const validateNeighbour = (id: string | null | undefined) => {
                if (id === undefined || id === null) return
                if (id === videoId) {
                    throw new BadRequestError({
                        message:
                            'Neighbour cannot be the same as the video being moved',
                    })
                }
                if (!rows.some((r) => r.videoId === id)) {
                    throw new BadRequestError({
                        message: 'Neighbour video is not in this playlist',
                    })
                }
            }
            validateNeighbour(payload.afterId)
            validateNeighbour(payload.beforeId)

            const nextIds = reorderIds(
                rows.map((r) => r.videoId),
                videoId,
                { afterId: payload.afterId, beforeId: payload.beforeId },
            )

            await Promise.all(
                nextIds.map((id, idx) =>
                    tx.courseVideo.update({
                        where: {
                            courseId_videoId: {
                                courseId: playlistId,
                                videoId: id,
                            },
                        },
                        data: { order: idx },
                    }),
                ),
            )

            return nextIds.indexOf(videoId)
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

        return { videoId, order: newOrder }
    }
}
