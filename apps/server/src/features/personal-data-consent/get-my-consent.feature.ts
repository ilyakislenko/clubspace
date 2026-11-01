import { z } from 'zod'

import { MyConsentOutputSchema } from './schemas'

export const GetMyConsentFeatureOutputSchema = MyConsentOutputSchema

export class GetMyConsentFeature {
    constructor(readonly userId: string) {}
}

export type GetMyConsentFeatureResponse = z.infer<
    typeof GetMyConsentFeatureOutputSchema
>
