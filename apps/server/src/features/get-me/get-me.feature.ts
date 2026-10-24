import { z } from 'zod'

import { MeOutputSchema } from './schemas'

export const GetMeFeatureOutputSchema = MeOutputSchema

export class GetMeFeature {
    constructor(readonly userId: string) {}
}

export type GetMeFeatureResponse = z.infer<typeof GetMeFeatureOutputSchema>
