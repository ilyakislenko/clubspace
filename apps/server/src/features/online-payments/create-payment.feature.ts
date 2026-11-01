import { z } from 'zod'

import { MyPaymentOutputSchema } from './schemas'

export const CreatePaymentInputSchema = z.object({
    planId: z.string().uuid(),
})
export const CreatePaymentOutputSchema = z.object({
    payment: MyPaymentOutputSchema,
    // The provider's page; the app opens it in the browser.
    confirmationUrl: z.string(),
})

export class CreatePaymentFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePaymentInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}
export type CreatePaymentFeatureResponse = z.infer<
    typeof CreatePaymentOutputSchema
>
