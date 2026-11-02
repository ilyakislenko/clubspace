import { z } from 'zod'

import { EventPaymentMethodSchema, EventRegistrantSchema } from './schemas'

export const MarkEventRegistrationPaidInputSchema = z.object({
    // Paid at the club: cash or a transfer.
    method: EventPaymentMethodSchema,
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
