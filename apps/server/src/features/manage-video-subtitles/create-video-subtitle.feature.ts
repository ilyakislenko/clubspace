import { z } from 'zod'

// publicUrl is round-tripped from the upload presign endpoint, but the
// admin client could lie and persist any URL it likes. Reject anything
// that isn't http(s) so a `javascript:` href can't sneak into the
// subtitle row and execute when an admin clicks the "Файл" link.
const httpsOnlyUrl = z
    .string()
    .url()
    .refine(
        (v) => {
            try {
                const u = new URL(v)
                return u.protocol === 'http:' || u.protocol === 'https:'
            } catch {
                return false
            }
        },
        { message: 'Only http(s) URLs are allowed' },
    )

export const CreateVideoSubtitleFeatureInputSchema = z.object({
    language: z
        .string()
        .min(1)
        .max(16)
        .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'BCP-47 language tag expected'),
    label: z.string().min(1).max(64),
    storageKey: z.string().min(1),
    publicUrl: httpsOnlyUrl,
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
