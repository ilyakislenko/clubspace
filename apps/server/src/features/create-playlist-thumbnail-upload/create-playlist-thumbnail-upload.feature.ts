import { z } from 'zod'

// Static photo formats only — animated images (gif, apng, animated webp)
// would render as motion next to actual videos and confuse the catalog.
// HEIC/HEIF/SVG also rejected: HEIC doesn't decode in browsers, SVG is a
// script-execution surface for stored XSS.
export const ALLOWED_THUMBNAIL_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
] as const

export const CreatePlaylistThumbnailUploadFeatureInputSchema = z.object({
    contentType: z.enum(ALLOWED_THUMBNAIL_CONTENT_TYPES),
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
