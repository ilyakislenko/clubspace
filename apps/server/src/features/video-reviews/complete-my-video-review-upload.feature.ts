import { z } from 'zod'

import { VideoReviewSummarySchema } from './schemas'

export const CompleteMyVideoReviewUploadFeatureOutputSchema = VideoReviewSummarySchema

export class CompleteMyVideoReviewUploadFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly requestId: string,
    ) {}
}

export type CompleteMyVideoReviewUploadFeatureResponse = z.infer<
    typeof CompleteMyVideoReviewUploadFeatureOutputSchema
>
