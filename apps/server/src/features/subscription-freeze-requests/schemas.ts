import { z } from 'zod'

import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import { personName, requestUntilYmd } from './freeze-request-utils'

export const SubscriptionFreezeRequestOutputSchema = z.object({
    id: z.string().uuid(),
    subscriptionId: z.string().uuid(),
    userId: z.string().uuid(),
    status: z.enum(['PENDING', 'APPROVED', 'DECLINED', 'CANCELLED']),
    // Club-local days (YYYY-MM-DD), both inclusive; untilDate = fromDate + days - 1.
    fromDate: z.iso.date(),
    untilDate: z.iso.date(),
    days: z.number().int(),
    reason: z.string(),
    // Shown to the member on a decline.
    decisionComment: z.string().nullable(),
    // «Фамилия Имя» of the coach who decided; never the e-mail.
    decidedByName: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
})
export type SubscriptionFreezeRequestOutput = z.infer<
    typeof SubscriptionFreezeRequestOutputSchema
>

// A request in the staff queue, with who asked and for which abonement.
export const PendingFreezeRequestSchema =
    SubscriptionFreezeRequestOutputSchema.extend({
        memberName: z.string(),
        planName: z.string(),
    })

export const PendingFreezeRequestsOutputSchema = z.object({
    data: z.array(PendingFreezeRequestSchema),
})

// The start dates a member may ask for, in club-local days.
export const FreezeRequestWindowSchema = z.object({
    today: z.iso.date(),
    firstDate: z.iso.date(),
    lastDate: z.iso.date(),
    maxDays: z.number().int(),
})

export const serializeFreezeRequest = (r: {
    id: string
    subscriptionId: string
    userId: string
    status: string
    fromDate: Date
    days: number
    reason: string
    decisionComment: string | null
    decidedAt: Date | null
    createdAt: Date
    decidedBy?: { firstname: string | null; lastname: string | null } | null
}): SubscriptionFreezeRequestOutput => ({
    id: r.id,
    subscriptionId: r.subscriptionId,
    userId: r.userId,
    status: r.status as SubscriptionFreezeRequestOutput['status'],
    fromDate: dbDateToYmd(r.fromDate),
    untilDate: requestUntilYmd(dbDateToYmd(r.fromDate), r.days),
    days: r.days,
    reason: r.reason,
    decisionComment: r.decisionComment,
    decidedByName: personName(r.decidedBy),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
})
