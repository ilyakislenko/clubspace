import { z } from 'zod'

import {
    PaymentJournalEntrySchema,
    PaymentJournalFilterSchema,
    PaymentJournalTotalSchema,
    PaymentJournalUnappliedSchema,
} from './schemas'

export const PAYMENT_JOURNAL_DEFAULT_PER_PAGE = 50
export const PAYMENT_JOURNAL_MAX_PER_PAGE = 200

export const ListPaymentJournalInputSchema = PaymentJournalFilterSchema.extend({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(PAYMENT_JOURNAL_MAX_PER_PAGE).optional(),
})

export const ListPaymentJournalOutputSchema = z.object({
    data: z.array(PaymentJournalEntrySchema),
    // Rows of the view across all pages.
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    // Over the whole view, per currency (the dominant one first).
    totals: z.array(PaymentJournalTotalSchema),
    // Page 1 only: the club's paid-but-unapplied online payments, whatever
    // the filters (an alert); oldest first, at most 20.
    unapplied: z
        .object({
            total: z.number().int(),
            data: z.array(PaymentJournalUnappliedSchema),
        })
        .nullable(),
})

export class ListPaymentJournalFeature {
    constructor(
        readonly payload: z.infer<typeof ListPaymentJournalInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListPaymentJournalFeatureResponse = z.infer<typeof ListPaymentJournalOutputSchema>
