import { z } from 'zod'

export const SetPersonalTrainingOfferInputSchema = z.object({
    enabled: z.boolean(),
})

export const SetPersonalTrainingOfferOutputSchema = z.object({
    offersPersonalTraining: z.boolean(),
})

export class SetPersonalTrainingOfferFeature {
    constructor(
        readonly payload: z.infer<typeof SetPersonalTrainingOfferInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type SetPersonalTrainingOfferFeatureResponse = z.infer<
    typeof SetPersonalTrainingOfferOutputSchema
>
