import { z } from 'zod'

import { ClubPaymentMethodSchema } from '../../shared/utils/payment-method'
import { EventRegistrantSchema } from './schemas'

export const MarkEventRegistrationPaidInputSchema = z.object({
    // Paid at the club: cash, a transfer or a card on the terminal. ONLINE is
    // set by the payment webhook only.
    method: ClubPaymentMethodSchema,
    // A club discount picked from listSaleDiscounts (with `eventId`).
    discountId: z.string().uuid().optional(),
    // What was actually received; omitted = the event's price (with the
    // discount). Any role that may mark may type it, as for abonements; a
    // reduction is recorded as a one-off discount with who set it.
    amount: z.number().int().min(0).max(10_000_000).optional(),
})
export const MarkEventRegistrationPaidOutputSchema = EventRegistrantSchema

export class MarkEventRegistrationPaidFeature {
    constructor(
        readonly payload: z.infer<typeof MarkEventRegistrationPaidInputSchema>,
        readonly workspaceId: string,
        readonly registrationId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type MarkEventRegistrationPaidFeatureResponse = z.infer<
    typeof MarkEventRegistrationPaidOutputSchema
>
