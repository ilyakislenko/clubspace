import { z } from 'zod'

export const UpdatePlaylistChapterFeatureInputSchema = z.object({
    title: z.string().min(1).max(255).optional(),
})

export const UpdatePlaylistChapterFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    order: z.number().int(),
})

export class UpdatePlaylistChapterFeature {
    constructor(
        readonly payload: z.infer<
            typeof UpdatePlaylistChapterFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly chapterId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdatePlaylistChapterFeatureResponse = z.infer<
    typeof UpdatePlaylistChapterFeatureOutputSchema
>
