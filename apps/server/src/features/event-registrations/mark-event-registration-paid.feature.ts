import { z } from 'zod'

import { ClubPaymentMethodSchema } from '../../shared/utils/payment-method'
import { EventRegistrantSchema } from './schemas'

export const MarkEventRegistrationPaidInputSchema = z.object({
    // Paid at the club: cash, a transfer or a card on the terminal. ONLINE is
    // set by the payment webhook only.
    method: ClubPaymentMethodSchema,
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
