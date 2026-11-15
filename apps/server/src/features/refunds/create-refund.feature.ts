import { z } from 'zod'

import { REFUND_TARGETS } from '../../domains/payments/services/refund.service'
import { PaymentMethodSchema } from '../../shared/utils/payment-method'
import { PaymentJournalEntryDetailOutputSchema } from '../payment-journal/get-payment-journal-entry.feature'
import { PaymentJournalEntrySchema } from '../payment-journal/schemas'

// Money returned for one sale (abonement / ticket) or for an online payment
// that never became one (`unapplied`). Flat, no union (conventions §1): the
// handler refuses a method the target can't take.
export const CreateRefundInputSchema = z.object({
    target: z.enum(REFUND_TARGETS),
    // Subscription / event registration / payment id.
    targetId: z.string().uuid(),
    // Whole currency units, the mark-paid bound.
    amount: z.number().int().min(1).max(10_000_000),
    // CASH / TRANSFER / CARD = a record only; ONLINE = through the provider.
    method: PaymentMethodSchema,
    reason: z.string().trim().min(1).max(500),
})

export const CreateRefundOutputSchema = z.object({
    // The new refund as a journal row.
    refund: PaymentJournalEntrySchema,
    // The refunded sale with its refunds (null for an unapplied payment).
    sale: PaymentJournalEntryDetailOutputSchema.nullable(),
})

export class CreateRefundFeature {
    constructor(
        readonly payload: z.infer<typeof CreateRefundInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateRefundFeatureResponse = z.infer<typeof CreateRefundOutputSchema>
