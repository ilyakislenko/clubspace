import { z } from 'zod'

import type { ReviewViewerRole } from './review-clip-access'

export const GetVideoReviewPlaybackFeatureOutputSchema = z.object({
    // Signed HLS master playlist through the server's proxy.
    hlsUrl: z.string(),
})

export class GetVideoReviewPlaybackFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly viewer: ReviewViewerRole,
        readonly requestId: string,
    ) {}
}

export type GetVideoReviewPlaybackFeatureResponse = z.infer<
    typeof GetVideoReviewPlaybackFeatureOutputSchema
>
