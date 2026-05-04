import { z } from 'zod'

export const DeletePlaylistChapterFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeletePlaylistChapterFeature {
    constructor(
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly chapterId: string,
        readonly invokerUserId: string,
    ) {}
}

export type DeletePlaylistChapterFeatureResponse = z.infer<
    typeof DeletePlaylistChapterFeatureOutputSchema
>
