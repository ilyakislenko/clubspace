import { z } from 'zod'

export const UpdatePlaylistVideoFeatureInputSchema = z.object({
    // null = remove the lesson from any chapter (back to "ungrouped").
    chapterId: z.string().uuid().nullable().optional(),
})

export const UpdatePlaylistVideoFeatureOutputSchema = z.object({
    videoId: z.string().uuid(),
    chapterId: z.string().uuid().nullable(),
    order: z.number().int(),
})

export class UpdatePlaylistVideoFeature {
    constructor(
        readonly payload: z.infer<typeof UpdatePlaylistVideoFeatureInputSchema>,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly videoId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdatePlaylistVideoFeatureResponse = z.infer<
    typeof UpdatePlaylistVideoFeatureOutputSchema
>
