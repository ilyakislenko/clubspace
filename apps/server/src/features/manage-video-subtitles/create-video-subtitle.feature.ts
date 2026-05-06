import { z } from 'zod'

export const CreateVideoSubtitleFeatureInputSchema = z.object({
    language: z
        .string()
        .min(1)
        .max(16)
        .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'BCP-47 language tag expected'),
    label: z.string().min(1).max(64),
    storageKey: z.string().min(1),
    publicUrl: z.string().url(),
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
