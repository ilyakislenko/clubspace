import { z } from 'zod'

// An abonement sold but not paid yet — what the club still has to collect.
export const AwaitingPaymentRowSchema = z.object({
    subscriptionId: z.string().uuid(),
    userId: z.string().uuid(),
    memberName: z.string(),
    planName: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    // null = the abonement has not started yet (waits for the first visit).
    startDate: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
})

export const AwaitingPaymentOutputSchema = z.object({
    data: z.array(AwaitingPaymentRowSchema),
    // All unpaid rows; `data` is capped, so total > data.length means truncated.
    total: z.number().int(),
})

export class ListAwaitingPaymentFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListAwaitingPaymentFeatureResponse = z.infer<
    typeof AwaitingPaymentOutputSchema
>
