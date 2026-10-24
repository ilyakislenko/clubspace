import { z } from 'zod'

import { PersonalTrainingOutputSchema } from './schemas'

export const GetPersonalTrainingOutputSchema = PersonalTrainingOutputSchema

export class GetPersonalTrainingFeature {
    constructor(
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetPersonalTrainingFeatureResponse = z.infer<
    typeof GetPersonalTrainingOutputSchema
>
