import { z } from 'zod'

export const AttachVideosToPlaylistFeatureInputSchema = z.object({
    videoIds: z.array(z.string().uuid()).min(1).max(200),
})

export const AttachVideosToPlaylistFeatureOutputSchema = z.object({
    added: z.number().int(),
    skipped: z.number().int(),
})

export class AttachVideosToPlaylistFeature {
    constructor(
        readonly payload: z.infer<
            typeof AttachVideosToPlaylistFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly invokerUserId: string,
    ) {}
}

export type AttachVideosToPlaylistFeatureResponse = z.infer<
    typeof AttachVideosToPlaylistFeatureOutputSchema
>
