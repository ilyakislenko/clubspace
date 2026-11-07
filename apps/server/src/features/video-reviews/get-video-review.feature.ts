import { z } from 'zod'

import { VideoReviewDetailSchema } from './schemas'

export const GetVideoReviewFeatureOutputSchema = VideoReviewDetailSchema

export class GetVideoReviewFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly isStaff: boolean,
        readonly requestId: string,
    ) {}
}

export type GetVideoReviewFeatureResponse = z.infer<typeof GetVideoReviewFeatureOutputSchema>
