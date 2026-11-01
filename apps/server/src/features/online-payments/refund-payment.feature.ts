import { z } from 'zod'

import { PaymentOutputSchema } from './schemas'

export const RefundPaymentOutputSchema = PaymentOutputSchema

export class RefundPaymentFeature {
    constructor(
        readonly workspaceId: string,
        readonly paymentId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RefundPaymentFeatureResponse = z.infer<
    typeof RefundPaymentOutputSchema
>
