import { z } from 'zod'

import { ClosePersonalTrainingInputSchema } from './decline-personal-training.feature'
import { PersonalTrainingOutputSchema } from './schemas'

export const CancelPersonalTrainingOutputSchema = PersonalTrainingOutputSchema

export class CancelPersonalTrainingFeature {
    constructor(
        readonly payload: z.infer<typeof ClosePersonalTrainingInputSchema>,
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CancelPersonalTrainingFeatureResponse = z.infer<
    typeof CancelPersonalTrainingOutputSchema
>
