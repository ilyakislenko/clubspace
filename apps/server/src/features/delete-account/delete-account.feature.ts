import { z } from 'zod'

// The code from POST /send-auth-code, requested for the account's own
// address right before deleting: a valid access token alone never deletes.
export const DeleteAccountFeatureInputSchema = z.object({
    code: z.string().length(6),
})

export const DeleteAccountFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteAccountFeature {
    constructor(
        readonly payload: z.infer<typeof DeleteAccountFeatureInputSchema>,
        readonly userId: string,
        // Wrong codes are counted per (account, address) like at sign-in.
        readonly clientIp: string,
    ) {}
}

export type DeleteAccountFeatureResponse = z.infer<
    typeof DeleteAccountFeatureOutputSchema
>
