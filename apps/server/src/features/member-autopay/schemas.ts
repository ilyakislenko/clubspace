import { z } from 'zod'

import {
    AUTOPAY_CANCEL_SOURCES,
    AUTOPAY_NEEDS_ACTION_REASONS,
} from '../../domains/autopay/autopay-rules'
import type { AutopayView } from './member-autopay-view'

// Member autopay as its member and staff read it
// (docs/design/2026-11-15-member-autopay.md §3.5). Never the token: the card
// is a label («карта •• 4444»).

const NextChargeSchema = z.object({
    // Club-local day of the next charge; a pack: «когда закончатся занятия,
    // не позже {on}».
    on: z.iso.date(),
    amount: z.number().int(),
    kind: z.enum(['term', 'pack']),
})

const NewTermsSchema = z.object({
    amount: z.number().int(),
    durationDays: z.number().int(),
    classCount: z.number().int().nullable(),
    // The consent text version accepting them records (echoed back).
    consentVersion: z.string(),
})

export const MyAutopaySchema = z.object({
    id: z.string().uuid(),
    // null once the tariff was deleted (planName is the snapshot).
    planId: z.string().uuid().nullable(),
    planName: z.string(),
    status: z.enum(['ACTIVE', 'NEEDS_ACTION', 'CANCELLED']),
    needsActionReason: z.enum(AUTOPAY_NEEDS_ACTION_REASONS).nullable(),
    cardLabel: z.string(),
    // The agreed terms: renewal amount, term, pack size (null: time-only).
    termsAmount: z.number().int(),
    currency: z.string(),
    termsDurationDays: z.number().int(),
    termsClassCount: z.number().int().nullable(),
    // null while nothing is due (waits for a first visit, stopped, cancelled,
    // or new terms wait for the member's confirmation).
    nextCharge: NextChargeSchema.nullable(),
    // The last decline (Russian text) and its club-local day; the retry day.
    lastError: z.string().nullable(),
    lastFailedOn: z.iso.date().nullable(),
    nextAttemptOn: z.iso.date().nullable(),
    // The tariff's current terms when they are less favourable than agreed:
    // nothing is charged until the member accepts them.
    newTerms: NewTermsSchema.nullable(),
    consentedAt: z.iso.datetime(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelSource: z.enum(AUTOPAY_CANCEL_SOURCES).nullable(),
    cancelReason: z.string().nullable(),
})
export type MyAutopay = z.infer<typeof MyAutopaySchema>

// Staff: the same, plus who cancelled and when it was set up. Money and the
// card (amounts, card label) only for club admins — null for a head coach.
export const MemberAutopaySchema = MyAutopaySchema.extend({
    cardLabel: z.string().nullable(),
    termsAmount: z.number().int().nullable(),
    nextCharge: NextChargeSchema.extend({ amount: z.number().int().nullable() }).nullable(),
    newTerms: NewTermsSchema.extend({ amount: z.number().int().nullable() }).nullable(),
    cancelledBy: z.object({ userId: z.string().uuid(), name: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
})
export type MemberAutopayDto = z.infer<typeof MemberAutopaySchema>

export const serializeMyAutopay = (v: AutopayView): MyAutopay => ({
    id: v.row.id,
    planId: v.row.planId,
    planName: v.row.planName,
    status: v.row.status,
    needsActionReason: v.needsActionReason,
    cardLabel: v.cardLabel,
    termsAmount: v.row.termsAmount,
    currency: v.row.currency,
    termsDurationDays: v.row.termsDurationDays,
    termsClassCount: v.row.termsClassCount,
    nextCharge: v.nextCharge,
    lastError: v.row.lastError,
    lastFailedOn: v.lastFailedOn,
    nextAttemptOn: v.nextAttemptOn,
    newTerms: v.newTerms,
    consentedAt: v.row.consentedAt.toISOString(),
    cancelledAt: v.row.cancelledAt?.toISOString() ?? null,
    cancelSource: v.cancelSource,
    cancelReason: v.row.cancelReason,
})

export const serializeMemberAutopay = (
    v: AutopayView,
    seesMoney: boolean,
    staffNames: ReadonlyMap<string, string>,
): MemberAutopayDto => {
    const mine = serializeMyAutopay(v)
    return {
        ...mine,
        cardLabel: seesMoney ? mine.cardLabel : null,
        termsAmount: seesMoney ? mine.termsAmount : null,
        nextCharge: mine.nextCharge && {
            ...mine.nextCharge,
            amount: seesMoney ? mine.nextCharge.amount : null,
        },
        newTerms: mine.newTerms && {
            ...mine.newTerms,
            amount: seesMoney ? mine.newTerms.amount : null,
        },
        cancelledBy: v.row.cancelledById
            ? {
                  userId: v.row.cancelledById,
                  name: staffNames.get(v.row.cancelledById) ?? 'Сотрудник',
              }
            : null,
        createdAt: v.row.createdAt.toISOString(),
    }
}
