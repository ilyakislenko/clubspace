import { z } from 'zod'

import { AUTOPAY_NEEDS_ACTION_REASONS } from '../../domains/autopay/autopay-rules'
import { AnalyticsFilterSchema } from '../club-analytics/schemas'

export const AWAITING_DEFAULT_PER_PAGE = 50
export const AWAITING_MAX_PER_PAGE = 200

// «Ожидают оплаты» (domains/subscriptions/renewal-rules: awaitingPaymentWhere).
// Gym / direction / group / coach narrow it to the members of the matching
// groups (an id from another club is a 404).
export const ListAwaitingPaymentInputSchema = AnalyticsFilterSchema.extend({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce
        .number()
        .int()
        .positive()
        .max(AWAITING_MAX_PER_PAGE)
        .optional(),
})

export type ListAwaitingPaymentInput = z.infer<
    typeof ListAwaitingPaymentInputSchema
>

// An abonement sold but not paid yet — what the club still has to collect.
export const AwaitingPaymentRowSchema = z.object({
    subscriptionId: z.string().uuid(),
    userId: z.string().uuid(),
    memberName: z.string(),
    memberPhone: z.string().nullable(),
    planId: z.string().uuid(),
    planName: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    // null = the abonement has not started yet (waits for the first visit).
    startDate: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
})

// «Автоплатёж не прошёл»: a member whose autopay charge failed
// (docs/design/2026-11-15-member-autopay.md §3.5). No amount — it is not a
// debt and not part of the receivable above.
export const AutopayAttentionRowSchema = z.object({
    autopayId: z.string().uuid(),
    member: z.object({ userId: z.string().uuid(), name: z.string() }),
    planName: z.string(),
    // Why it stopped; null while declines are pending and retries remain.
    reason: z.enum(AUTOPAY_NEEDS_ACTION_REASONS).nullable(),
    // The last decline in Russian.
    lastError: z.string().nullable(),
    // Club-local day of the next retry; null = stopped, waits for the member.
    nextAttemptOn: z.iso.date().nullable(),
    since: z.iso.datetime(),
})

export const AwaitingPaymentOutputSchema = z.object({
    data: z.array(AwaitingPaymentRowSchema),
    // Unpaid abonements matching the filters, across all pages.
    total: z.number().int(),
    // The people who hold them (one member may owe for several).
    members: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    // Stopped agreements and those with declines pending, in the same
    // filters, oldest first (capped at 50; `total` counts all).
    autopayAttention: z.object({
        total: z.number().int(),
        data: z.array(AutopayAttentionRowSchema),
    }),
})

export class ListAwaitingPaymentFeature {
    constructor(
        readonly payload: ListAwaitingPaymentInput,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListAwaitingPaymentFeatureResponse = z.infer<
    typeof AwaitingPaymentOutputSchema
>
