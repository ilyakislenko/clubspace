import { z } from 'zod'

import { newCardDueAt, NEW_CARD } from './review-scheduler'

export const BookmarkReviewScheduleSchema = z.object({
    bookmarkId: z.string().uuid(),
    dueAt: z.iso.datetime(),
    // 0 = graded «again»: due again minutes later.
    intervalDays: z.number().int(),
    ease: z.number(),
    reps: z.number().int(),
    lapses: z.number().int(),
    // null = never reviewed (a «new» card).
    lastReviewedAt: z.iso.datetime().nullable(),
})

export type BookmarkReviewSchedule = z.infer<typeof BookmarkReviewScheduleSchema>

type ReviewRow = {
    dueAt: Date
    intervalDays: number
    ease: number
    reps: number
    lapses: number
    lastReviewedAt: Date
}

/** The bookmark's schedule; without a review row it is a new card. */
export const serializeBookmarkReview = (
    bookmark: { id: string; createdAt: Date },
    review: ReviewRow | null,
): BookmarkReviewSchedule =>
    review
        ? {
              bookmarkId: bookmark.id,
              dueAt: review.dueAt.toISOString(),
              intervalDays: review.intervalDays,
              ease: review.ease,
              reps: review.reps,
              lapses: review.lapses,
              lastReviewedAt: review.lastReviewedAt.toISOString(),
          }
        : {
              bookmarkId: bookmark.id,
              dueAt: newCardDueAt(bookmark.createdAt).toISOString(),
              ...NEW_CARD,
              lastReviewedAt: null,
          }
