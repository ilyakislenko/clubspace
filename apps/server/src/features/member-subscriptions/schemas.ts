import { z } from 'zod'

import {
    dbDateToYmd,
    freezeDays,
} from '../../domains/subscriptions/freeze-dates'

export const SubscriptionOutputSchema = z.object({
    id: z.string().uuid(),
    planId: z.string().uuid(),
    planName: z.string(),
    status: z.string(),
    startDate: z.iso.datetime().nullable(),
    endDate: z.iso.datetime().nullable(),
    // Snapshot from the plan at sale; null durationDays = a row from before it existed.
    durationDays: z.number().int().nullable(),
    startsOnFirstVisit: z.boolean(),
    amountPaid: z.number().int(),
    currency: z.string(),
    // Class-pack balance (null for a time-only tariff).
    classesTotal: z.number().int().nullable(),
    classesRemaining: z.number().int().nullable(),
    source: z.string(),
    createdAt: z.iso.datetime(),
})
export type SubscriptionOutput = z.infer<typeof SubscriptionOutputSchema>

// A pause of the abonement's clock. Dates are club-local calendar days
// (YYYY-MM-DD), both inclusive; `days` is derived from them.
export const SubscriptionFreezeOutputSchema = z.object({
    id: z.string().uuid(),
    subscriptionId: z.string().uuid(),
    fromDate: z.iso.date(),
    untilDate: z.iso.date(),
    days: z.number().int(),
    reason: z.string().nullable(),
    endedEarlyAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
})
export type SubscriptionFreezeOutput = z.infer<
    typeof SubscriptionFreezeOutputSchema
>

export const MemberSubscriptionsOutputSchema = z.object({
    current: SubscriptionOutputSchema.nullable(),
    history: z.array(SubscriptionOutputSchema),
    freezes: z.array(SubscriptionFreezeOutputSchema),
})

export const AssignSubscriptionOutputSchema = z.object({
    subscription: SubscriptionOutputSchema,
    accessUntil: z.iso.datetime().nullable(),
})

export const FreezeSubscriptionOutputSchema = z.object({
    freeze: SubscriptionFreezeOutputSchema,
    subscription: SubscriptionOutputSchema,
    accessUntil: z.iso.datetime().nullable(),
})

// `freeze` is null when the freeze had not started and was removed outright.
export const EndSubscriptionFreezeOutputSchema = z.object({
    freeze: SubscriptionFreezeOutputSchema.nullable(),
    returnedDays: z.number().int(),
    subscription: SubscriptionOutputSchema,
    accessUntil: z.iso.datetime().nullable(),
})

export const serializeSubscription = (s: {
    id: string
    planId: string
    plan?: { name: string } | null
    status: string
    startDate: Date | null
    endDate: Date | null
    durationDays: number | null
    startsOnFirstVisit: boolean
    amountPaid: number
    currency: string
    classesTotal: number | null
    classesRemaining: number | null
    source: string
    createdAt: Date
}): SubscriptionOutput => ({
    id: s.id,
    planId: s.planId,
    planName: s.plan?.name ?? '—',
    status: s.status,
    startDate: s.startDate ? s.startDate.toISOString() : null,
    endDate: s.endDate ? s.endDate.toISOString() : null,
    durationDays: s.durationDays,
    startsOnFirstVisit: s.startsOnFirstVisit,
    amountPaid: s.amountPaid,
    currency: s.currency,
    classesTotal: s.classesTotal,
    classesRemaining: s.classesRemaining,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
})

export const serializeSubscriptionFreeze = (f: {
    id: string
    subscriptionId: string
    fromDate: Date
    untilDate: Date
    reason: string | null
    endedEarlyAt: Date | null
    createdAt: Date
}): SubscriptionFreezeOutput => ({
    id: f.id,
    subscriptionId: f.subscriptionId,
    fromDate: dbDateToYmd(f.fromDate),
    untilDate: dbDateToYmd(f.untilDate),
    days: freezeDays(f),
    reason: f.reason,
    endedEarlyAt: f.endedEarlyAt ? f.endedEarlyAt.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
})
