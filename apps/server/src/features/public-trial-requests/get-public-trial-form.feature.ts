import type { z } from 'zod'

import { PublicTrialFormSchema } from './schemas'

export const GetPublicTrialFormOutputSchema = PublicTrialFormSchema

export class GetPublicTrialFormFeature {
    constructor(readonly slug: string) {}
}
export type GetPublicTrialFormFeatureResponse = z.infer<typeof GetPublicTrialFormOutputSchema>
