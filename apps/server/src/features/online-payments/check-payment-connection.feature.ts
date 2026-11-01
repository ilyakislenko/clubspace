import { z } from 'zod'

export const CheckPaymentConnectionOutputSchema = z.object({
    ok: z.boolean(),
    // The provider's test mode (test_ / sk_test_ keys): payments are not real.
    testMode: z.boolean(),
    // Shop / account the keys belong to, when the provider reports it.
    accountId: z.string().nullable(),
    // Russian, shown as is.
    message: z.string(),
    verifiedAt: z.iso.datetime().nullable(),
})

export class CheckPaymentConnectionFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CheckPaymentConnectionFeatureResponse = z.infer<
    typeof CheckPaymentConnectionOutputSchema
>
