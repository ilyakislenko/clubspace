import { z } from 'zod'

import { PublicLegalOutputSchema } from './schemas'

export const GetPublicLegalOutputSchema = PublicLegalOutputSchema

// Public: the /legal/* pages of the public site read it before anyone signs in.
export class GetPublicLegalFeature {}

export type GetPublicLegalFeatureResponse = z.infer<typeof GetPublicLegalOutputSchema>
