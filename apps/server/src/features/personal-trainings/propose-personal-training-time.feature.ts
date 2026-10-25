import { z } from 'zod'

import { ProposedTimeSchema } from './request-personal-training.feature'
import { PersonalTrainingOutputSchema } from './schemas'

export const ProposePersonalTrainingTimeInputSchema = z.object({
    ...ProposedTimeSchema.shape,
    comment: z.string().trim().max(500).optional(),
})

export const ProposePersonalTrainingTimeOutputSchema =
    PersonalTrainingOutputSchema

export class ProposePersonalTrainingTimeFeature {
    constructor(
        readonly payload: z.infer<
            typeof ProposePersonalTrainingTimeInputSchema
        >,
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ProposePersonalTrainingTimeFeatureResponse = z.infer<
    typeof ProposePersonalTrainingTimeOutputSchema
>
