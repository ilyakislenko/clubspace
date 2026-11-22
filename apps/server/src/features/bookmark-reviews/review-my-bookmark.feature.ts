import { z } from 'zod'

import { REVIEW_GRADES } from './review-scheduler'
import { BookmarkReviewScheduleSchema } from './schemas'

export const ReviewMyBookmarkFeatureInputSchema = z.object({
    grade: z.enum(REVIEW_GRADES),
    // Client clock of the grade (it may have been made offline and replayed).
    // A grade not newer than the last applied one is ignored, so a retried
    // request never counts twice.
    reviewedAt: z.iso.datetime(),
})

export const ReviewMyBookmarkFeatureOutputSchema = BookmarkReviewScheduleSchema

export class ReviewMyBookmarkFeature {
    constructor(
        readonly userId: string,
        readonly videoId: string,
        readonly bookmarkId: string,
        readonly payload: z.infer<typeof ReviewMyBookmarkFeatureInputSchema>,
    ) {}
}

export type ReviewMyBookmarkFeatureResponse = z.infer<
    typeof ReviewMyBookmarkFeatureOutputSchema
>
