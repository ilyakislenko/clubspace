import { z } from 'zod'

import { MyPaymentOutputSchema } from './schemas'

export const GetMyPaymentOutputSchema = MyPaymentOutputSchema

export class GetMyPaymentFeature {
    constructor(
        readonly workspaceId: string,
        readonly paymentId: string,
        readonly userId: string,
    ) {}
}
export type GetMyPaymentFeatureResponse = z.infer<typeof GetMyPaymentOutputSchema>
