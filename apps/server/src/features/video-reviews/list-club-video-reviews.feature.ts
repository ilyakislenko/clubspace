import { z } from 'zod'

import type { ReviewViewerRole } from './review-clip-access'
import { VideoReviewSummarySchema } from './schemas'

export const ListClubVideoReviewsFeatureInputSchema = z.object({
    // Omitted: every request, the waiting ones first.
    status: z.enum(['open', 'answered', 'closed']).optional(),
})

export const ListClubVideoReviewsFeatureOutputSchema = z.object({
    items: z.array(VideoReviewSummarySchema),
})

export class ListClubVideoReviewsFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly viewer: ReviewViewerRole,
        readonly payload: z.infer<typeof ListClubVideoReviewsFeatureInputSchema>,
    ) {}
}

export type ListClubVideoReviewsFeatureResponse = z.infer<
    typeof ListClubVideoReviewsFeatureOutputSchema
>
