import { z } from 'zod'

export const DeleteGymFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
    orphanedGroupCount: z.number().int(),
})

export class DeleteGymFeature {
    constructor(
        readonly workspaceId: string,
        readonly gymId: string,
        readonly invokerUserId: string,
    ) {}
}

export type DeleteGymFeatureResponse = z.infer<
    typeof DeleteGymFeatureOutputSchema
>
