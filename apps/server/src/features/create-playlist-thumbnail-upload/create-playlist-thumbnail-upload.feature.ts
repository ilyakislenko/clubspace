import { z } from 'zod'

export const CreatePlaylistThumbnailUploadFeatureInputSchema = z.object({
    contentType: z.string().min(1),
})

export const CreatePlaylistThumbnailUploadFeatureOutputSchema = z.object({
    key: z.string(),
    publicUrl: z.string().url(),
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
    }),
})

export class CreatePlaylistThumbnailUploadFeature {
    constructor(
        readonly payload: z.infer<
            typeof CreatePlaylistThumbnailUploadFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly playlistId: string,
    ) {}
}

export type CreatePlaylistThumbnailUploadFeatureResponse = z.infer<
    typeof CreatePlaylistThumbnailUploadFeatureOutputSchema
>
