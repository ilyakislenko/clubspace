import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    PutMyVideoBookmarkFeature,
    PutMyVideoBookmarkFeatureResponse,
} from './put-my-video-bookmark.feature'
import { loadVideoForStudent, serializeMyVideoBookmark } from './schemas'

@Feature(PutMyVideoBookmarkFeature)
export class PutMyVideoBookmarkHandler
    implements
        IFeatureHandler<
            PutMyVideoBookmarkFeature,
            PutMyVideoBookmarkFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        userId,
        videoId,
        bookmarkId,
        payload,
    }: PutMyVideoBookmarkFeature) {
        if (payload.endSec !== null && payload.endSec <= payload.positionSec) {
            throw new BadRequestError({
                message: 'Конец отрезка должен быть позже начала',
            })
        }
        const { workspaceId } = await loadVideoForStudent(
            this.prisma,
            userId,
            videoId,
        )
        const updatedAt = new Date(payload.updatedAt)
        const data = {
            positionSec: payload.positionSec,
            endSec: payload.endSec,
            label: payload.label,
            note: payload.note,
            updatedAt,
            deletedAt: payload.deleted ? updatedAt : null,
        }

        const existing = await this.prisma.videoBookmark.findUnique({
            where: { id: bookmarkId },
        })
        if (existing) {
            // The id is client-generated — never let it address someone
            // else's row (or move a row between videos).
            if (existing.userId !== userId || existing.videoId !== videoId) {
                throw new NotFoundError({ message: 'Закладка не найдена' })
            }
            // Last-write-wins, tombstones included: a stale offline edit must
            // neither clobber a newer one nor resurrect a newer delete.
            if (existing.updatedAt > updatedAt) {
                return serializeMyVideoBookmark(existing)
            }
            const row = await this.prisma.videoBookmark.update({
                where: { id: bookmarkId },
                data,
            })
            return serializeMyVideoBookmark(row)
        }

        const row = await this.prisma.videoBookmark.create({
            data: { id: bookmarkId, userId, videoId, workspaceId, ...data },
        })
        return serializeMyVideoBookmark(row)
    }
}
