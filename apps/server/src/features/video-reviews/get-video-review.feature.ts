import { z } from 'zod'

import type { ReviewViewerRole } from './review-clip-access'
import { VideoReviewDetailSchema } from './schemas'

export const GetVideoReviewFeatureOutputSchema = VideoReviewDetailSchema

export class GetVideoReviewFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly viewer: ReviewViewerRole,
        readonly requestId: string,
    ) {}
}

export type GetVideoReviewFeatureResponse = z.infer<typeof GetVideoReviewFeatureOutputSchema>
