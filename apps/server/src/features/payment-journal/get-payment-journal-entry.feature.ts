import { z } from 'zod'

import { PaymentJournalEntrySchema } from './schemas'

export const PaymentJournalEntryDetailOutputSchema = PaymentJournalEntrySchema.extend({
    // The sale's refunds, newest first (phase B; empty until then).
    refunds: z.array(PaymentJournalEntrySchema),
    // The holder is a member of the club now: the panel links to their card.
    memberHasCard: z.boolean(),
})

export class GetPaymentJournalEntryFeature {
    constructor(
        readonly entryId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetPaymentJournalEntryFeatureResponse = z.infer<
    typeof PaymentJournalEntryDetailOutputSchema
>
