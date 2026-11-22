import { z } from 'zod'

import type { ReviewViewerRole } from './review-clip-access'
import { ReviewDrawingSchema, VideoReviewDetailSchema } from './schemas'

export const AddVideoReviewCommentFeatureInputSchema = z.object({
    atSec: z.number().int().min(0),
    // Must be > atSec when set (checked in the handler).
    endSec: z.number().int().nullable().default(null),
    text: z.string().trim().min(1).max(2000),
    drawing: ReviewDrawingSchema.nullable().default(null),
})

// Only the fields sent change; the range is checked after merging.
export const UpdateVideoReviewCommentFeatureInputSchema = z.object({
    atSec: z.number().int().min(0).optional(),
    endSec: z.number().int().nullable().optional(),
    text: z.string().trim().min(1).max(2000).optional(),
    // null removes the drawing.
    drawing: ReviewDrawingSchema.nullable().optional(),
})

export const VideoReviewCommentFeatureOutputSchema = VideoReviewDetailSchema

export class AddVideoReviewCommentFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly viewer: ReviewViewerRole,
        readonly requestId: string,
        readonly payload: z.infer<typeof AddVideoReviewCommentFeatureInputSchema>,
    ) {}
}

export class UpdateVideoReviewCommentFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly viewer: ReviewViewerRole,
        readonly requestId: string,
        readonly commentId: string,
        readonly payload: z.infer<typeof UpdateVideoReviewCommentFeatureInputSchema>,
    ) {}
}

export class DeleteVideoReviewCommentFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly viewer: ReviewViewerRole,
        readonly requestId: string,
        readonly commentId: string,
    ) {}
}

export type VideoReviewCommentFeatureResponse = z.infer<
    typeof VideoReviewCommentFeatureOutputSchema
>
