import { z } from 'zod'

export const CreateVideoThumbnailUploadFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    contentType: z.string().min(1),
})

export const CreateVideoThumbnailUploadFeatureOutputSchema = z.object({
    key: z.string(),
    publicUrl: z.string().url(),
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
    }),
})

export class CreateVideoThumbnailUploadFeature {
    constructor(
        readonly payload: z.infer<
            typeof CreateVideoThumbnailUploadFeatureInputSchema
        >,
        readonly videoId: string,
    ) {}
}

export type CreateVideoThumbnailUploadFeatureResponse = z.infer<
    typeof CreateVideoThumbnailUploadFeatureOutputSchema
>
