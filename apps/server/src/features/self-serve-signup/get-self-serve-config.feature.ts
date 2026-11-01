import { z } from 'zod'

export const GetSelfServeConfigOutputSchema = z.object({
    // The admin's /sign-up page shows the wizard only when this is on.
    enabled: z.boolean(),
    // Every new club gets this many days with all paid modules on.
    trialDays: z.number().int(),
    // The offer + DPA editions creating a club accepts; the wizard links them
    // and sends them back with the club.
    offerVersion: z.string(),
    dpaVersion: z.string(),
})

// Public: read before anyone has signed in.
export class GetSelfServeConfigFeature {}

export type GetSelfServeConfigFeatureResponse = z.infer<
    typeof GetSelfServeConfigOutputSchema
>
