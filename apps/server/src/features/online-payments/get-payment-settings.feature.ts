import { z } from 'zod'

import { PaymentSettingsOutputSchema } from './schemas'

export const GetPaymentSettingsOutputSchema = PaymentSettingsOutputSchema

export class GetPaymentSettingsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetPaymentSettingsFeatureResponse = z.infer<
    typeof GetPaymentSettingsOutputSchema
>
