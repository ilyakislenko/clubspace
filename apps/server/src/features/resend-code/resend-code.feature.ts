import { z } from 'zod'

export const ResendCodeFeatureInputSchema = z.object({
    userId: z.string().uuid(),
})

export const ResendCodeFeatureOutputSchema = z.object({
    success: z.boolean(),
})

export class ResendCodeFeature {
    constructor(
        readonly payload: z.infer<typeof ResendCodeFeatureInputSchema>,
    ) {}
}

export type ResendCodeFeatureResponse = z.infer<
    typeof ResendCodeFeatureOutputSchema
>
