import { z } from 'zod'

import { PersonalTrainingOutputSchema } from './schemas'

export const ListPersonalTrainingsInputSchema = z.object({
    // 'workspace' (every request in the club) needs admin scope.
    view: z.enum(['mine', 'workspace']).optional(),
})

export const ListPersonalTrainingsOutputSchema = z.object({
    data: z.array(PersonalTrainingOutputSchema),
    // The caller may take personal sessions (coaching role).
    canOffer: z.boolean(),
    offersPersonalTraining: z.boolean(),
    // Other coaches a member can currently request.
    coachesAvailable: z.number().int(),
})

export class ListPersonalTrainingsFeature {
    constructor(
        readonly payload: z.infer<typeof ListPersonalTrainingsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListPersonalTrainingsFeatureResponse = z.infer<
    typeof ListPersonalTrainingsOutputSchema
>
