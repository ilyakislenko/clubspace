import { z } from 'zod'

import { MyVideoBookmarkSchema } from '../manage-my-video-bookmarks/schemas'
import { BookmarkReviewScheduleSchema } from './schemas'

// At most this many due cards per answer (oldest-due first); the rest come
// with the next fetch.
export const MY_REVIEWS_LIMIT = 30
// `upcomingCount` looks this far ahead.
export const MY_REVIEWS_UPCOMING_DAYS = 7

export const ListMyReviewsFeatureOutputSchema = z.object({
    items: z.array(
        z.object({
            bookmark: MyVideoBookmarkSchema,
            video: z.object({
                id: z.string().uuid(),
                title: z.string(),
                thumbnailUrl: z.string().nullable(),
                duration: z.number().int().nullable(),
            }),
            course: z
                .object({ id: z.string().uuid(), title: z.string() })
                .nullable(),
            schedule: BookmarkReviewScheduleSchema,
            // Days until the next review per grade, for the buttons' hints
            // (0 = «again», minutes away).
            nextIntervals: z.object({
                again: z.number().int(),
                hard: z.number().int(),
                good: z.number().int(),
                easy: z.number().int(),
            }),
        }),
    ),
    // Every card due now (items holds at most MY_REVIEWS_LIMIT of them).
    dueCount: z.number().int(),
    // Not due yet, but due within MY_REVIEWS_UPCOMING_DAYS.
    upcomingCount: z.number().int(),
    // The soonest due date after now; null when nothing is scheduled later.
    nextDueAt: z.iso.datetime().nullable(),
    // Live bookmarks in this club — 0 = the member never saved anything.
    totalCount: z.number().int(),
})

export class ListMyReviewsFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        // Staff see every course (drafts, all audiences) when we pick the
        // course a video belongs to — same rule as list-my-video-notes.
        readonly isStaff: boolean,
    ) {}
}

export type ListMyReviewsFeatureResponse = z.infer<
    typeof ListMyReviewsFeatureOutputSchema
>
