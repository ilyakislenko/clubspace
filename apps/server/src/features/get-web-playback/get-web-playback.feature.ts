import { z } from 'zod'

export const GetWebPlaybackFeatureOutputSchema = z.object({
    // Presigned progressive-MP4 URL for the browser player (the PWA can't
    // play HLS outside Safari). Lives for the length of the video plus a
    // buffer, so seeking late in a long lesson still works.
    url: z.string(),
    mimeType: z.string(),
    expiresInSeconds: z.number().int(),
})

export class GetWebPlaybackFeature {
    constructor(
        readonly videoId: string,
        readonly userId: string,
    ) {}
}

export type GetWebPlaybackFeatureResponse = z.infer<
    typeof GetWebPlaybackFeatureOutputSchema
>
