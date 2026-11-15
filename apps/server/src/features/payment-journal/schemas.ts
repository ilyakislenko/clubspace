import { z } from 'zod'

import { FORMER_STAFF_NAME } from '../../domains/discounts/priced-by'
import {
    JOURNAL_KINDS,
    JOURNAL_METHODS,
    type JournalPeople,
    type JournalRow,
    type UnappliedPaymentRow,
} from '../../domains/payments/journal'
import { PaymentMethodSchema } from '../../shared/utils/payment-method'
import { strictBoolean } from '../../shared/utils/strict-boolean'
import { displayName } from '../attendance/schemas'
import { AnalyticsFilterSchema } from '../club-analytics/schemas'
import { PaymentProviderSchema, PaymentStatusSchema } from '../online-payments/schemas'

export const PaymentJournalMethodSchema = z.enum(JOURNAL_METHODS)

// The journal's view, shared by the list and the CSV (exports/payments.csv).
// Dates: inclusive club-local days, both or neither (neither = the
// `revenue_30d` window), checked by domains/payments/journal
// resolveJournalPeriod. Gym / direction / group / coach = the analytics scope.
export const PaymentJournalFilterSchema = AnalyticsFilterSchema.extend({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    method: PaymentJournalMethodSchema.optional(),
    kind: z.enum(JOURNAL_KINDS).optional(),
    // Who marked the payment paid.
    markedById: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
    // «Со скидкой»: payments with a total discount > 0, named or one-off
    // (docs/design/2026-11-15-discounts.md §3.5).
    discounted: strictBoolean().optional(),
    // One discount of the club, archived included (a foreign id is a 404).
    discountId: z.string().uuid().optional(),
    // «Дал скидку»: payments whose price this staff member set.
    pricedById: z.string().uuid().optional(),
})
export type PaymentJournalFilter = z.infer<typeof PaymentJournalFilterSchema>

const PersonRefSchema = z.object({ userId: z.string().uuid(), name: z.string() })

// One journal row, flat (no union): a payment (sale) or, from phase B, a
// refund of one.
export const PaymentJournalEntrySchema = z.object({
    // `sub:<uuid>` / `reg:<uuid>` / `ref:<uuid>` — also the detail key.
    id: z.string(),
    kind: z.enum(['payment', 'refund']),
    source: z.enum(['abonement', 'ticket']),
    // Paid at (refund: refunded at).
    at: z.iso.datetime(),
    // Always positive; a refund row is drawn as «−».
    amount: z.number().int(),
    currency: z.string(),
    // null = not recorded («Не указан»).
    method: PaymentMethodSchema.nullable(),
    member: z.object({
        // null on a legacy row sold before the holder was stored.
        userId: z.string().uuid().nullable(),
        name: z.string(),
        // A member of the club now (their card opens); former members are text.
        isMember: z.boolean(),
    }),
    // Tariff name / event title.
    itemName: z.string(),
    subscriptionId: z.string().uuid().nullable(),
    eventRegistrationId: z.string().uuid().nullable(),
    eventId: z.string().uuid().nullable(),
    // Payment: who marked it paid (null: online, imported, unattributed).
    markedBy: PersonRefSchema.nullable(),
    // Payment rows: refunded so far and what may still be refunded.
    refundedAmount: z.number().int(),
    refundable: z.number().int(),
    // The provider's side of an online sale.
    online: z
        .object({
            paymentId: z.string().uuid(),
            provider: PaymentProviderSchema,
            // The provider's payment id, last 6 characters.
            providerRef: z.string().nullable(),
            status: PaymentStatusSchema,
            // What may still go back through the provider (amount − refunded
            // while SUCCEEDED, else 0).
            refundable: z.number().int(),
        })
        .nullable(),
    // Refund rows only.
    reason: z.string().nullable(),
    refundOf: z
        .object({ id: z.string(), at: z.iso.datetime(), amount: z.number().int() })
        .nullable(),
    // Payment rows: the tariff / event price the sale was made against (null:
    // recorded before discounts, imported — no discount shown) and its
    // discount: the named one (snapshot name, its part) and the one-off rest
    // (listPrice − named − amount). Refund rows: null / 0.
    listPrice: z.number().int().nullable(),
    discountName: z.string().nullable(),
    discountAmount: z.number().int(),
    oneOffDiscount: z.number().int(),
    // Who set the price — only when a one-off part exists or staff applied
    // the named discount (null online).
    pricedBy: PersonRefSchema.nullable(),
})
export type PaymentJournalEntry = z.infer<typeof PaymentJournalEntrySchema>

export const PaymentJournalTotalSchema = z.object({
    currency: z.string(),
    received: z.number().int(),
    refunded: z.number().int(),
    net: z.number().int(),
    byMethod: z.array(
        z.object({
            method: PaymentJournalMethodSchema,
            received: z.number().int(),
            refunded: z.number().int(),
            // Payment rows of this method.
            count: z.number().int(),
        }),
    ),
    // Over the view's payment rows: how many carry a discount, Σ the total
    // discount and its one-off part. Not part of `net` (revenue).
    discounted: z.object({
        count: z.number().int(),
        amount: z.number().int(),
        oneOffAmount: z.number().int(),
    }),
})

// Paid online, but the abonement / place could not be granted.
export const PaymentJournalUnappliedSchema = z.object({
    paymentId: z.string().uuid(),
    at: z.iso.datetime(),
    // isMember: a member of the club now (their card opens).
    member: PersonRefSchema.extend({ isMember: z.boolean() }),
    itemName: z.string(),
    amount: z.number().int(),
    refundable: z.number().int(),
    currency: z.string(),
    provider: PaymentProviderSchema,
    activationError: z.string().nullable(),
})

export const serializePaymentJournalEntry = (
    row: JournalRow,
    people: JournalPeople,
): PaymentJournalEntry => ({
    id: row.id,
    kind: row.kind,
    source: row.source,
    at: row.at.toISOString(),
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    member: {
        userId: row.userId,
        name: row.person ? displayName(row.person) : 'Участник',
        isMember: row.userId !== null && people.members.has(row.userId),
    },
    itemName: row.itemName,
    subscriptionId: row.subscriptionId,
    eventRegistrationId: row.eventRegistrationId,
    eventId: row.eventId,
    markedBy: row.markedById
        ? { userId: row.markedById, name: people.names.get(row.markedById) ?? 'Сотрудник' }
        : null,
    refundedAmount: row.refundedAmount,
    refundable: row.kind === 'payment' ? Math.max(0, row.amount - row.refundedAmount) : 0,
    online: row.online
        ? {
              paymentId: row.online.id,
              provider: row.online.provider,
              providerRef: row.online.providerPaymentId?.slice(-6) ?? null,
              status: row.online.status,
              refundable:
                  row.online.status === 'SUCCEEDED'
                      ? Math.max(0, row.online.amount - row.online.refundedAmount)
                      : 0,
          }
        : null,
    reason: row.reason,
    refundOf: row.refundOf
        ? { id: row.refundOf.id, at: row.refundOf.at.toISOString(), amount: row.refundOf.amount }
        : null,
    listPrice: row.listPrice,
    discountName: row.discount.named > 0 ? row.discountName : null,
    discountAmount: row.discount.named,
    oneOffDiscount: row.discount.oneOff,
    pricedBy:
        row.pricedById && row.discount.total > 0
            ? { userId: row.pricedById, name: people.names.get(row.pricedById) ?? FORMER_STAFF_NAME }
            : null,
})

export const serializePaymentJournalUnapplied = (
    p: UnappliedPaymentRow,
    people: JournalPeople,
): z.infer<typeof PaymentJournalUnappliedSchema> => ({
    paymentId: p.id,
    at: (p.paidAt ?? p.createdAt).toISOString(),
    member: { userId: p.userId, name: displayName(p.user), isMember: people.members.has(p.userId) },
    itemName: p.planName,
    amount: p.amount,
    refundable: Math.max(0, p.amount - p.refundedAmount),
    currency: p.currency,
    provider: p.provider,
    activationError: p.activationError,
})
