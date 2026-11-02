import { z } from 'zod'

import { CreatePaymentOutputSchema } from '../online-payments/create-payment.feature'

// The same answer as buying a tariff online: the pending Payment and the
// provider's page the app opens. No input — the amount is the event's price.
export const PayEventRegistrationOnlineOutputSchema = CreatePaymentOutputSchema

export class PayEventRegistrationOnlineFeature {
    constructor(
        readonly workspaceId: string,
        readonly registrationId: string,
        // The member the place is for (the child when a guardian acts as it).
        readonly invokerUserId: string,
        // Who pressed the button: the guardian under act-as, else the member.
        readonly actorUserId: string,
    ) {}
}

export type PayEventRegistrationOnlineFeatureResponse = z.infer<
    typeof PayEventRegistrationOnlineOutputSchema
>
