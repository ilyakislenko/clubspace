import { z } from 'zod'

// VTT is the universal browser-supported format. We accept SRT too because
// existing libraries spit it out and convert on the fly with `webvtt` (the
// admin client passes either content type to the presigned PUT and the
// player tolerates both via expo-video / video.js fallbacks).
export const ALLOWED_SUBTITLE_CONTENT_TYPES = [
    'text/vtt',
    'application/x-subrip',
] as const

export const CreateVideoSubtitleUploadFeatureInputSchema = z.object({
    language: z
        .string()
        .min(1)
        .max(16)
        .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'BCP-47 language tag expected'),
    contentType: z.enum(ALLOWED_SUBTITLE_CONTENT_TYPES),
})

export const CreateVideoSubtitleUploadFeatureOutputSchema = z.object({
    key: z.string(),
    publicUrl: z.string().url(),
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
    }),
})

export class CreateVideoSubtitleUploadFeature {
    constructor(
        readonly payload: z.infer<
            typeof CreateVideoSubtitleUploadFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly videoId: string,
    ) {}
}

export type CreateVideoSubtitleUploadFeatureResponse = z.infer<
    typeof CreateVideoSubtitleUploadFeatureOutputSchema
>
