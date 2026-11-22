import { z } from 'zod'

import { MAX_REVIEW_CLIP_BYTES, MAX_REVIEW_CLIP_DURATION_SEC } from './video-reviews-utils'
import { VideoReviewSummarySchema } from './schemas'

export const CreateMyVideoReviewFeatureInputSchema = z.object({
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().max(2000).nullable().default(null),
    // Only video files; the worker vets the actual container too.
    contentType: z.string().regex(/^video\/[a-z0-9.+-]+$/i, 'Нужен видеофайл'),
    // Signed into the upload URL: storage refuses a body of another length.
    sizeBytes: z.number().int().min(1).max(MAX_REVIEW_CLIP_BYTES),
    // As the picker reports it; the worker re-checks the real length.
    durationSec: z.number().min(0).max(MAX_REVIEW_CLIP_DURATION_SEC).optional(),
})

export const CreateMyVideoReviewFeatureOutputSchema = z.object({
    request: VideoReviewSummarySchema,
    // PUT the file here, then call …/complete.
    upload: z.object({ url: z.string(), method: z.literal('PUT') }),
})

export class CreateMyVideoReviewFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly payload: z.infer<typeof CreateMyVideoReviewFeatureInputSchema>,
    ) {}
}

export type CreateMyVideoReviewFeatureResponse = z.infer<
    typeof CreateMyVideoReviewFeatureOutputSchema
>
