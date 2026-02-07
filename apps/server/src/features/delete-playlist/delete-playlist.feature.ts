import { z } from 'zod'

export const DeletePlaylistFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeletePlaylistFeature {
    constructor(
        readonly workspaceId: string,
        readonly playlistId: string,
    ) {}
}

export type DeletePlaylistFeatureResponse = z.infer<
    typeof DeletePlaylistFeatureOutputSchema
>
