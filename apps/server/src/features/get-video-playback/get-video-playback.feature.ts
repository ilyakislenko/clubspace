import { z } from 'zod'

export const GetVideoPlaybackFeatureOutputSchema = z.object({
    hlsUrl: z.string().url(),
})

export class GetVideoPlaybackFeature {
    constructor(readonly videoId: string, readonly userId: string) {}
}

export type GetVideoPlaybackFeatureResponse = z.infer<
    typeof GetVideoPlaybackFeatureOutputSchema
>
