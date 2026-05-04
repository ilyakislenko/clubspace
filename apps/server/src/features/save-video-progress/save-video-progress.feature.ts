import { z } from 'zod'

export const SaveVideoProgressFeatureInputSchema = z.object({
    position: z.number().min(0).optional(),
    completed: z.boolean().optional(),
    /**
     * Optional duration in seconds reported by the player. Used to
     * back-fill `Video.duration` when the upload pipeline didn't capture
     * it, and as the source of truth for the auto-complete (>=90%) check.
     */
    duration: z.number().min(0).optional(),
})

export const SaveVideoProgressFeatureOutputSchema = z.object({
    videoId: z.string().uuid(),
    position: z.number(),
    completed: z.boolean(),
    watchedAt: z.iso.datetime(),
})

export class SaveVideoProgressFeature {
    constructor(
        readonly userId: string,
        readonly videoId: string,
        readonly payload: z.infer<
            typeof SaveVideoProgressFeatureInputSchema
        >,
    ) {}
}

export type SaveVideoProgressFeatureResponse = z.infer<
    typeof SaveVideoProgressFeatureOutputSchema
>
