import { z } from 'zod'

import {
    StudyPlanDescriptionSchema,
    StudyPlanDetailSchema,
    StudyPlanTitleSchema,
} from './schemas'

export const CreateMyStudyPlanFeatureInputSchema = z.object({
    title: StudyPlanTitleSchema,
    description: StudyPlanDescriptionSchema.default(null),
})

export const CreateMyStudyPlanFeatureOutputSchema = StudyPlanDetailSchema

export class CreateMyStudyPlanFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly payload: z.infer<typeof CreateMyStudyPlanFeatureInputSchema>,
    ) {}
}

export type CreateMyStudyPlanFeatureResponse = z.infer<
    typeof CreateMyStudyPlanFeatureOutputSchema
>
