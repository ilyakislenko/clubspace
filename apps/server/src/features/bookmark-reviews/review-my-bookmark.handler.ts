import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { loadVideoForStudent } from '../manage-my-video-bookmarks/schemas'
import { applyGrade, dueAfter, NEW_CARD } from './review-scheduler'
import {
    ReviewMyBookmarkFeature,
    ReviewMyBookmarkFeatureResponse,
} from './review-my-bookmark.feature'
import { serializeBookmarkReview } from './schemas'

// A device clock this far ahead is wrong, not offline: its grade would push
// the card out and shadow every honest grade until that time.
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

@Feature(ReviewMyBookmarkFeature)
export class ReviewMyBookmarkHandler
    implements
        IFeatureHandler<ReviewMyBookmarkFeature, ReviewMyBookmarkFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        userId,
        videoId,
        bookmarkId,
        payload,
    }: ReviewMyBookmarkFeature): Promise<ReviewMyBookmarkFeatureResponse> {
        const reviewedAt = new Date(payload.reviewedAt)
        if (reviewedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
            throw new BadRequestError({
                message: 'Время оценки в будущем — проверьте часы устройства',
            })
        }
        await loadVideoForStudent(this.prisma, userId, videoId)

        const bookmark = await this.prisma.videoBookmark.findUnique({
            where: { id: bookmarkId },
            include: { review: true },
        })
        // Someone else's, another lesson's or a deleted bookmark is not
        // reviewable (and must not be told apart from a missing one).
        if (
            !bookmark ||
            bookmark.userId !== userId ||
            bookmark.videoId !== videoId ||
            bookmark.deletedAt !== null
        ) {
            throw new NotFoundError({ message: 'Закладка не найдена' })
        }

        const current = bookmark.review
        // A replayed or out-of-order grade: keep the schedule as it is.
        if (current && reviewedAt <= current.lastReviewedAt) {
            return serializeBookmarkReview(bookmark, current)
        }

        const state = applyGrade(current ?? NEW_CARD, payload.grade)
        const next = {
            ...state,
            dueAt: dueAfter(reviewedAt, state.intervalDays),
            lastReviewedAt: reviewedAt,
        }

        if (current) {
            // Conditional on the stamp, so two concurrent grades can't both
            // apply: the newer one wins, an older one changes nothing.
            const { count } = await this.prisma.bookmarkReview.updateMany({
                where: { bookmarkId, lastReviewedAt: { lt: reviewedAt } },
                data: next,
            })
            if (count > 0) return serializeBookmarkReview(bookmark, next)
            return await this.storedSchedule(bookmark)
        }

        try {
            const row = await this.prisma.bookmarkReview.create({
                data: {
                    bookmarkId,
                    userId,
                    workspaceId: bookmark.workspaceId,
                    ...next,
                },
            })
            return serializeBookmarkReview(bookmark, row)
        } catch (e) {
            if ((e as { code?: string }).code !== 'P2002') throw e
            // A concurrent first grade (e.g. a retry) created it first.
            return await this.storedSchedule(bookmark)
        }
    }

    private async storedSchedule(bookmark: { id: string; createdAt: Date }) {
        const row = await this.prisma.bookmarkReview.findUnique({
            where: { bookmarkId: bookmark.id },
        })
        return serializeBookmarkReview(bookmark, row)
    }
}
