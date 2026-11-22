import { z } from 'zod'

import { VideoReviewSummarySchema } from './schemas'

export const SetVideoReviewStatusFeatureInputSchema = z.object({
    // Staff: answered / closed / open. The member: closed, or open to ask again.
    status: z.enum(['open', 'answered', 'closed']),
})

export const SetVideoReviewStatusFeatureOutputSchema = VideoReviewSummarySchema

export class SetVideoReviewStatusFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly isStaff: boolean,
        readonly requestId: string,
        readonly payload: z.infer<typeof SetVideoReviewStatusFeatureInputSchema>,
    ) {}
}

export type SetVideoReviewStatusFeatureResponse = z.infer<
    typeof SetVideoReviewStatusFeatureOutputSchema
>
