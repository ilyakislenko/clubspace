import { z } from 'zod'

export const GetOfflineManifestFeatureOutputSchema = z.object({
    // A flat HLS media playlist (one rung) with absolute, presigned segment
    // URLs — ready for the mobile client to download segment-by-segment.
    manifest: z.string(),
})

export class GetOfflineManifestFeature {
    constructor(
        readonly videoId: string,
        readonly userId: string,
    ) {}
}

export type GetOfflineManifestFeatureResponse = z.infer<
    typeof GetOfflineManifestFeatureOutputSchema
>
