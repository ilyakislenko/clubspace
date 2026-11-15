import { z } from 'zod'

import { MyAutopaySchema } from './schemas'

// The member accepts the tariff's new terms (MyAutopay.newTerms), echoing
// exactly what the screen showed: a mismatch means they changed again (409).
export const AcceptMyAutopayTermsInputSchema = z.object({
    amount: z.number().int().min(0).max(100_000_000),
    durationDays: z.number().int().positive().max(3650),
    classCount: z.number().int().positive().max(1000).nullable(),
    consentVersion: z.string().trim().min(1).max(64),
})
export const AcceptMyAutopayTermsOutputSchema = MyAutopaySchema

export class AcceptMyAutopayTermsFeature {
    constructor(
        readonly payload: z.infer<typeof AcceptMyAutopayTermsInputSchema>,
        readonly workspaceId: string,
        readonly autopayId: string,
        readonly invokerUserId: string,
    ) {}
}
export type AcceptMyAutopayTermsFeatureResponse = z.infer<
    typeof AcceptMyAutopayTermsOutputSchema
>
