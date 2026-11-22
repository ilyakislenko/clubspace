import { z } from 'zod'

import { MemberAutopaySchema } from './schemas'

// Staff stop a member's autopay at the member's request (by phone, at the
// desk). The reason is kept and shown on the card.
export const CancelMemberAutopayInputSchema = z.object({
    reason: z.string().trim().min(1).max(200),
})
export const CancelMemberAutopayOutputSchema = MemberAutopaySchema

export class CancelMemberAutopayFeature {
    constructor(
        readonly payload: z.infer<typeof CancelMemberAutopayInputSchema>,
        readonly workspaceId: string,
        readonly autopayId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CancelMemberAutopayFeatureResponse = z.infer<
    typeof CancelMemberAutopayOutputSchema
>
