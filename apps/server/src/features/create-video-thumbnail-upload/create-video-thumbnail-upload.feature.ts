import { z } from 'zod'

import { ALLOWED_THUMBNAIL_CONTENT_TYPES } from '../create-playlist-thumbnail-upload/create-playlist-thumbnail-upload.feature'

export const CreateVideoThumbnailUploadFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    contentType: z.enum(ALLOWED_THUMBNAIL_CONTENT_TYPES),
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
        // workspaceId arrives separately, resolved by @RequestWorkspaceId().
        readonly payload: Omit<
            z.infer<typeof CreateVideoThumbnailUploadFeatureInputSchema>,
            'workspaceId'
        >,
        readonly workspaceId: string,
        readonly videoId: string,
    ) {}
}

export type CreateVideoThumbnailUploadFeatureResponse = z.infer<
    typeof CreateVideoThumbnailUploadFeatureOutputSchema
>
