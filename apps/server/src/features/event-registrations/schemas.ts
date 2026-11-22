import { z } from 'zod'

import { saleDiscount } from '../../domains/discounts/discount-rules'
import { type PricedByNames, pricedByRef } from '../../domains/discounts/priced-by'
import {
    PaymentMethodSchema,
    type PaymentMethodValue,
} from '../../shared/utils/payment-method'
import { nameOrPlaceholder } from '../../shared/utils/person-name'

export const EventRegistrationStatusSchema = z.enum([
    'BOOKED',
    'WAITLISTED',
    'CANCELLED',
])
export type EventRegistrationStatusValue = z.infer<
    typeof EventRegistrationStatusSchema
>

// A member's registration for an event, as the member sees it.
export const EventRegistrationOutputSchema = z.object({
    id: z.string().uuid(),
    eventId: z.string().uuid(),
    status: EventRegistrationStatusSchema,
    // 1-based place in the waitlist; null unless WAITLISTED.
    waitlistPosition: z.number().int().nullable(),
    // The ticket is paid (marked by staff, or paid online) and how — a ticket
    // paid ONLINE is refunded by the club, not cancelled in the app.
    isPaid: z.boolean(),
    paymentMethod: PaymentMethodSchema.nullable(),
    // Got the place from the waitlist at this instant.
    promotedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
})
export type EventRegistrationOutput = z.infer<
    typeof EventRegistrationOutputSchema
>

// Places of an event with a price or a limit, on the event list: how many are
// taken / queued and the viewer's own live registration.
export const EventRegistrationSummarySchema = z.object({
    booked: z.number().int(),
    waitlist: z.number().int(),
    mine: EventRegistrationOutputSchema.nullable(),
    // The club takes this event's ticket online (its payment provider is
    // connected and the event is paid): an unpaid place shows «Оплатить
    // онлайн».
    onlinePayment: z.boolean(),
})
export type EventRegistrationSummary = z.infer<
    typeof EventRegistrationSummarySchema
>

// One registration on the staff list.
export const EventRegistrantSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    name: z.string(),
    status: EventRegistrationStatusSchema,
    waitlistPosition: z.number().int().nullable(),
    // A guardian registered the member (a child).
    bookedByOther: z.boolean(),
    isPaid: z.boolean(),
    paidAt: z.iso.datetime().nullable(),
    amountPaid: z.number().int().nullable(),
    currency: z.string().nullable(),
    // Σ of this ticket's refunds; amountPaid stays what was taken.
    refundedAmount: z.number().int(),
    paymentMethod: PaymentMethodSchema.nullable(),
    // The price facts of a paid ticket (docs/design/2026-11-15-discounts.md
    // §1): the event's price when marked (null: marked before discounts
    // existed), the named discount (name snapshot, its part) and the derived
    // one-off reduction (listPrice − discount − amount, ≥ 0).
    listPrice: z.number().int().nullable(),
    discountId: z.string().uuid().nullable(),
    discountName: z.string().nullable(),
    discountAmount: z.number().int(),
    oneOffDiscount: z.number().int(),
    // Who set the amount (staff marking it); null online / unpaid.
    pricedBy: z.object({ userId: z.string().uuid(), name: z.string() }).nullable(),
    promotedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
})
export type EventRegistrant = z.infer<typeof EventRegistrantSchema>

export type RegistrationRow = {
    id: string
    eventId: string
    userId: string
    status: EventRegistrationStatusValue
    bookedById: string | null
    isPaid: boolean
    paidAt: Date | null
    amountPaid: number | null
    currency: string | null
    paymentMethod: PaymentMethodValue | null
    refundedAmount: number
    listPrice: number | null
    discountId: string | null
    discountName: string | null
    discountAmount: number
    pricedById: string | null
    promotedAt: Date | null
    cancelledAt: Date | null
    createdAt: Date
}

// Oldest first — the order the waitlist is promoted in.
export const byQueueOrder = (
    a: { createdAt: Date; id: string },
    b: { createdAt: Date; id: string },
): number =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)

// 1-based waitlist place of each WAITLISTED row among `rows`.
export const waitlistPositions = (
    rows: ReadonlyArray<{ id: string; status: string; createdAt: Date }>,
): Map<string, number> =>
    new Map(
        rows
            .filter((r) => r.status === 'WAITLISTED')
            .sort(byQueueOrder)
            .map((r, i) => [r.id, i + 1]),
    )

export const serializeRegistration = (
    r: Pick<
        RegistrationRow,
        | 'id'
        | 'eventId'
        | 'status'
        | 'isPaid'
        | 'paymentMethod'
        | 'promotedAt'
        | 'cancelledAt'
        | 'createdAt'
    >,
    waitlistPosition: number | null,
): EventRegistrationOutput => ({
    id: r.id,
    eventId: r.eventId,
    status: r.status,
    waitlistPosition: r.status === 'WAITLISTED' ? waitlistPosition : null,
    isPaid: r.isPaid,
    paymentMethod: r.paymentMethod,
    promotedAt: r.promotedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
})

export const serializeRegistrant = (
    r: RegistrationRow & {
        user: {
            firstname: string | null
            lastname: string | null
            email: string | null
        }
    },
    waitlistPosition: number | null,
    // Names of the staff who priced the rows (loadPricedByNames).
    pricedByNames?: PricedByNames,
): EventRegistrant => ({
    id: r.id,
    userId: r.userId,
    // Staff-facing: the e-mail tells two unnamed members apart.
    name:
        r.user.firstname || r.user.lastname
            ? nameOrPlaceholder(r.user)
            : (r.user.email ?? nameOrPlaceholder(r.user)),
    status: r.status,
    waitlistPosition: r.status === 'WAITLISTED' ? waitlistPosition : null,
    bookedByOther: r.bookedById !== null && r.bookedById !== r.userId,
    isPaid: r.isPaid,
    paidAt: r.paidAt?.toISOString() ?? null,
    amountPaid: r.amountPaid,
    currency: r.currency,
    refundedAmount: r.refundedAmount,
    paymentMethod: r.paymentMethod,
    listPrice: r.listPrice,
    discountId: r.discountId,
    discountName: r.discountName,
    discountAmount: r.discountAmount,
    oneOffDiscount: saleDiscount(r).oneOff,
    pricedBy: pricedByRef(r.pricedById, pricedByNames),
    promotedAt: r.promotedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
})
