import { z } from 'zod'

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

export const AwaitingPaymentOutputSchema = z.object({
    data: z.array(AwaitingPaymentRowSchema),
    // Unpaid abonements matching the filters, across all pages.
    total: z.number().int(),
    // The people who hold them (one member may owe for several).
    members: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
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
