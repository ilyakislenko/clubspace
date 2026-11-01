import { z } from 'zod'

import { SUBTITLE_LANGUAGE } from '../../shared/utils/storage-keys'

export const CreateVideoSubtitleFeatureInputSchema = z.object({
    language: z
        .string()
        .min(1)
        .max(16)
        .regex(SUBTITLE_LANGUAGE, 'BCP-47 language tag expected'),
    label: z.string().min(1).max(64),
    // The `key` returned by the upload-url endpoint. Only a key issued for
    // this video and language is accepted; the public URL is derived from it
    // server-side.
    storageKey: z.string().min(1).max(512),
    isDefault: z.boolean().optional(),
})

export const VideoSubtitleOutputSchema = z.object({
    id: z.string().uuid(),
    language: z.string(),
    label: z.string(),
    publicUrl: z.string().url(),
    isDefault: z.boolean(),
})

export class CreateVideoSubtitleFeature {
    constructor(
        readonly payload: z.infer<typeof CreateVideoSubtitleFeatureInputSchema>,
        readonly workspaceId: string,
        readonly videoId: string,
    ) {}
}

export type VideoSubtitleResponse = z.infer<typeof VideoSubtitleOutputSchema>
