import { z } from 'zod'

export const SubscriptionOutputSchema = z.object({
    id: z.string().uuid(),
    planId: z.string().uuid(),
    planName: z.string(),
    status: z.string(),
    startDate: z.iso.datetime(),
    endDate: z.iso.datetime().nullable(),
    amountPaid: z.number().int(),
    currency: z.string(),
    source: z.string(),
    createdAt: z.iso.datetime(),
})
export type SubscriptionOutput = z.infer<typeof SubscriptionOutputSchema>

export const MemberSubscriptionsOutputSchema = z.object({
    current: SubscriptionOutputSchema.nullable(),
    history: z.array(SubscriptionOutputSchema),
})

export const AssignSubscriptionOutputSchema = z.object({
    subscription: SubscriptionOutputSchema,
    accessUntil: z.iso.datetime().nullable(),
})

export const serializeSubscription = (s: {
    id: string
    planId: string
    plan?: { name: string } | null
    status: string
    startDate: Date
    endDate: Date | null
    amountPaid: number
    currency: string
    source: string
    createdAt: Date
}): SubscriptionOutput => ({
    id: s.id,
    planId: s.planId,
    planName: s.plan?.name ?? '—',
    status: s.status,
    startDate: s.startDate.toISOString(),
    endDate: s.endDate ? s.endDate.toISOString() : null,
    amountPaid: s.amountPaid,
    currency: s.currency,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
})
