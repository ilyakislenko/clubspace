import { z } from 'zod'

import {
    DirectionRefSchema,
    type DirectionRef,
} from '../../domains/directions/direction-ref'
import {
    dbDateToYmd,
    freezeDays,
} from '../../domains/subscriptions/freeze-dates'
import { SubscriptionFreezeRequestOutputSchema } from '../subscription-freeze-requests/schemas'

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
    // The agreed price while unpaid; the amount received once paid.
    amountPaid: z.number().int(),
    currency: z.string(),
    // false = sold, payment not marked yet («Ожидает оплаты»).
    isPaid: z.boolean(),
    // When the payment was marked; null while unpaid and on rows from before
    // payment tracking.
    paidAt: z.iso.datetime().nullable(),
    // Class-pack balance (null for a time-only tariff).
    classesTotal: z.number().int().nullable(),
    classesRemaining: z.number().int().nullable(),
    source: z.string(),
    createdAt: z.iso.datetime(),
    // Directions this abonement may be spent on (snapshot of the tariff at
    // sale). Empty = club-wide («Весь клуб»).
    directions: z.array(DirectionRefSchema),
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

// One of the member's current abonements (a member may hold several at once,
// each spent on its own directions).
export const MemberAbonementSchema = SubscriptionOutputSchema.extend({
    // The member's pending freeze request for this abonement (null when none).
    freezeRequest: SubscriptionFreezeRequestOutputSchema.nullable(),
    // Club-local day (YYYY-MM-DD) a back-to-back renewal of this abonement
    // starts: the day it ends. Null when the caller cannot renew over it (a
    // class pack, no end date, or no manage rights).
    renewFrom: z.iso.date().nullable(),
})
export type MemberAbonementOutput = z.infer<typeof MemberAbonementSchema>

export const MemberSubscriptionsOutputSchema = z.object({
    // The member's display name, so the screen can title itself from the
    // fetched data instead of a route param (which would end up in the URL).
    memberName: z.string(),
    // Current abonements, ending soonest first.
    abonements: z.array(MemberAbonementSchema),
    history: z.array(SubscriptionOutputSchema),
    freezes: z.array(SubscriptionFreezeOutputSchema),
    // What the caller may do with this member's abonements, so the UI shows
    // only buttons that will not answer 403: canManage = assign, mark paid,
    // freeze (admin scope, or a coach of the member's group); canCancel and
    // canUnmarkPayment = admin.
    permissions: z.object({
        canManage: z.boolean(),
        canCancel: z.boolean(),
        canUnmarkPayment: z.boolean(),
    }),
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
    isPaid: boolean
    paidAt: Date | null
    classesTotal: number | null
    classesRemaining: number | null
    source: string
    createdAt: Date
    directions: ReadonlyArray<{ direction: DirectionRef }>
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
    isPaid: s.isPaid,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    classesTotal: s.classesTotal,
    classesRemaining: s.classesRemaining,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
    directions: s.directions.map((d) => d.direction),
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
