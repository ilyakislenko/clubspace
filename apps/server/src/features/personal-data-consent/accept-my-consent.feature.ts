import { z } from 'zod'

import { MyConsentOutputSchema } from './schemas'

export const AcceptMyConsentFeatureInputSchema = z.object({
    // The edition the user was shown (GET /me/consent → currentVersion).
    version: z.string().trim().min(1).max(64),
})

export const AcceptMyConsentFeatureOutputSchema = MyConsentOutputSchema

export class AcceptMyConsentFeature {
    constructor(
        readonly payload: z.infer<typeof AcceptMyConsentFeatureInputSchema>,
        readonly userId: string,
        // Evidence of where the consent was given, stored on the record.
        readonly ip: string | null,
        readonly userAgent: string | null,
    ) {}
}

export type AcceptMyConsentFeatureResponse = z.infer<
    typeof AcceptMyConsentFeatureOutputSchema
>
