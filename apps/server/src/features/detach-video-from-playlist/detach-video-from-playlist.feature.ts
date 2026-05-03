import { z } from 'zod'

export const DetachVideoFromPlaylistFeatureOutputSchema = z.object({
    status: z.literal('removed'),
})

export class DetachVideoFromPlaylistFeature {
    constructor(
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly videoId: string,
        readonly invokerUserId: string,
    ) {}
}

export type DetachVideoFromPlaylistFeatureResponse = z.infer<
    typeof DetachVideoFromPlaylistFeatureOutputSchema
>
