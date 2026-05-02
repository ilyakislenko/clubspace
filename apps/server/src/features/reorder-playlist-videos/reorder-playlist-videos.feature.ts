import { z } from 'zod'

export const ReorderPlaylistVideosFeatureInputSchema = z.object({
    videoIds: z.array(z.string().uuid()).min(1),
})

export const ReorderPlaylistVideosFeatureOutputSchema = z.object({
    status: z.literal('reordered'),
    total: z.number().int(),
})

export class ReorderPlaylistVideosFeature {
    constructor(
        readonly payload: z.infer<
            typeof ReorderPlaylistVideosFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly invokerUserId: string,
    ) {}
}

export type ReorderPlaylistVideosFeatureResponse = z.infer<
    typeof ReorderPlaylistVideosFeatureOutputSchema
>
