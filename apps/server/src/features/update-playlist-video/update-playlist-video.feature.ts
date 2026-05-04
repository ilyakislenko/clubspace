import { z } from 'zod'

export const UpdatePlaylistVideoFeatureInputSchema = z.object({
    chapterTitle: z
        .string()
        .max(255)
        .nullable()
        .optional(),
})

export const UpdatePlaylistVideoFeatureOutputSchema = z.object({
    videoId: z.string().uuid(),
    chapterTitle: z.string().nullable(),
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
