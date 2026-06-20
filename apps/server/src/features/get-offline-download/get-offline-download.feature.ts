import { z } from 'zod'

export const GetOfflineDownloadFeatureOutputSchema = z.object({
    // A presigned, progressive-MP4 URL the mobile client downloads as a single
    // file for offline playback (playable from file:// on iOS and Android,
    // unlike the HLS renditions).
    url: z.string(),
    mimeType: z.string(),
})

export class GetOfflineDownloadFeature {
    constructor(
        readonly videoId: string,
        readonly userId: string,
    ) {}
}

export type GetOfflineDownloadFeatureResponse = z.infer<
    typeof GetOfflineDownloadFeatureOutputSchema
>
