import { z } from 'zod'

import { StudyPlanDetailSchema } from './schemas'

export const GetMyStudyPlanFeatureOutputSchema = StudyPlanDetailSchema

export class GetMyStudyPlanFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly planId: string,
    ) {}
}

export type GetMyStudyPlanFeatureResponse = z.infer<
    typeof GetMyStudyPlanFeatureOutputSchema
>
