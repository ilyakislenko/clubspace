import { z } from 'zod'

export const DeleteMyStudyPlanFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteMyStudyPlanFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly planId: string,
    ) {}
}

export type DeleteMyStudyPlanFeatureResponse = z.infer<
    typeof DeleteMyStudyPlanFeatureOutputSchema
>
