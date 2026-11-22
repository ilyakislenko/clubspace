import { z } from 'zod'

import {
    StudyPlanDescriptionSchema,
    StudyPlanDetailSchema,
    StudyPlanTitleSchema,
} from './schemas'

// Only the fields sent change.
export const UpdateMyStudyPlanFeatureInputSchema = z.object({
    title: StudyPlanTitleSchema.optional(),
    description: StudyPlanDescriptionSchema.optional(),
})

export const UpdateMyStudyPlanFeatureOutputSchema = StudyPlanDetailSchema

export class UpdateMyStudyPlanFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly planId: string,
        readonly payload: z.infer<typeof UpdateMyStudyPlanFeatureInputSchema>,
    ) {}
}

export type UpdateMyStudyPlanFeatureResponse = z.infer<
    typeof UpdateMyStudyPlanFeatureOutputSchema
>
