import { z } from 'zod'

import { EventRegistrantSchema } from './schemas'

export const MarkEventRegistrationPaidInputSchema = z.object({
    // Paid at the club: cash or a transfer. ONLINE is set by the payment
    // webhook only.
    method: z.enum(['CASH', 'TRANSFER']),
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
