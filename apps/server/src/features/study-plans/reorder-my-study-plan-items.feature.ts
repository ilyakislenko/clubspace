import { z } from 'zod'

import { StudyPlanDetailSchema } from './schemas'

export const ReorderMyStudyPlanItemsFeatureInputSchema = z.object({
    // Every item of the plan, each once, in the new play order.
    itemIds: z.array(z.string().uuid()).max(500),
})

export const ReorderMyStudyPlanItemsFeatureOutputSchema = StudyPlanDetailSchema

export class ReorderMyStudyPlanItemsFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly planId: string,
        readonly payload: z.infer<typeof ReorderMyStudyPlanItemsFeatureInputSchema>,
    ) {}
}

export type ReorderMyStudyPlanItemsFeatureResponse = z.infer<
    typeof ReorderMyStudyPlanItemsFeatureOutputSchema
>
