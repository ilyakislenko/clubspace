import { z } from 'zod'

export const CreatePlaylistChapterFeatureInputSchema = z.object({
    title: z.string().min(1).max(255),
})

export const CreatePlaylistChapterFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    order: z.number().int(),
})

export class CreatePlaylistChapterFeature {
    constructor(
        readonly payload: z.infer<
            typeof CreatePlaylistChapterFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CreatePlaylistChapterFeatureResponse = z.infer<
    typeof CreatePlaylistChapterFeatureOutputSchema
>
