import { z } from 'zod'

import { PaymentSettingsOutputSchema } from './schemas'

export const DeletePaymentSettingsOutputSchema = PaymentSettingsOutputSchema

export class DeletePaymentSettingsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeletePaymentSettingsFeatureResponse = z.infer<
    typeof DeletePaymentSettingsOutputSchema
>
