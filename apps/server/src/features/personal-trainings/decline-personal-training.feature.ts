import { z } from 'zod'

import { PersonalTrainingOutputSchema } from './schemas'

// Shared by decline and cancel: an optional reason shown to the other side.
export const ClosePersonalTrainingInputSchema = z.object({
    comment: z.string().trim().max(500).optional(),
})

export const DeclinePersonalTrainingOutputSchema = PersonalTrainingOutputSchema

export class DeclinePersonalTrainingFeature {
    constructor(
        readonly payload: z.infer<typeof ClosePersonalTrainingInputSchema>,
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeclinePersonalTrainingFeatureResponse = z.infer<
    typeof DeclinePersonalTrainingOutputSchema
>
