import { z } from 'zod'

export const GetPersonalTrainingFormOutputSchema = z.object({
    // Club timezone; a gym may carry its own (see gyms[].timezone).
    timezone: z.string(),
    coaches: z.array(
        z.object({
            userId: z.string().uuid(),
            displayName: z.string(),
        }),
    ),
    gyms: z.array(
        z.object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
            // Effective zone: the gym's own, else the club's.
            timezone: z.string(),
        }),
    ),
})

export class GetPersonalTrainingFormFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type GetPersonalTrainingFormFeatureResponse = z.infer<
    typeof GetPersonalTrainingFormOutputSchema
>
