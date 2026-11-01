import { z } from 'zod'

import { MyConsentOutputSchema } from './schemas'

export const GetMyConsentFeatureOutputSchema = MyConsentOutputSchema.extend({
    // A brand-new account with nothing in it (no club, no family, no
    // history): the consent screen offers «Не согласен», which deletes it,
    // instead of the full account deletion.
    isEmptyAccount: z.boolean(),
})

export class GetMyConsentFeature {
    constructor(readonly userId: string) {}
}

export type GetMyConsentFeatureResponse = z.infer<
    typeof GetMyConsentFeatureOutputSchema
>
