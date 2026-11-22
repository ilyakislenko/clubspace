import { z } from 'zod'

export const GetVideoReviewPlaybackFeatureOutputSchema = z.object({
    // Signed HLS master playlist through the server's proxy.
    hlsUrl: z.string(),
})

export class GetVideoReviewPlaybackFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly isStaff: boolean,
        readonly requestId: string,
    ) {}
}

export type GetVideoReviewPlaybackFeatureResponse = z.infer<
    typeof GetVideoReviewPlaybackFeatureOutputSchema
>
