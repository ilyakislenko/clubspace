import { z } from 'zod'

import { PersonalTrainingOutputSchema } from './schemas'

export const AcceptPersonalTrainingInputSchema = z.object({
    optionId: z.string().uuid(),
})

export const AcceptPersonalTrainingOutputSchema = PersonalTrainingOutputSchema

export class AcceptPersonalTrainingFeature {
    constructor(
        readonly payload: z.infer<typeof AcceptPersonalTrainingInputSchema>,
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type AcceptPersonalTrainingFeatureResponse = z.infer<
    typeof AcceptPersonalTrainingOutputSchema
>
