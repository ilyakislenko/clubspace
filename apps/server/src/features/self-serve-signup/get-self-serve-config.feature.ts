import { z } from 'zod'

export const GetSelfServeConfigOutputSchema = z.object({
    // The admin's /sign-up page shows the wizard only when this is on.
    enabled: z.boolean(),
    trialDays: z.number().int(),
    trialPlanName: z.string(),
})

// Public: read before anyone has signed in.
export class GetSelfServeConfigFeature {}

export type GetSelfServeConfigFeatureResponse = z.infer<
    typeof GetSelfServeConfigOutputSchema
>
