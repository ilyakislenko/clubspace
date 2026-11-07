import { z } from 'zod'

import { StudyPlanDetailSchema } from './schemas'

export const DeleteMyStudyPlanItemFeatureOutputSchema = StudyPlanDetailSchema

export class DeleteMyStudyPlanItemFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly planId: string,
        readonly itemId: string,
    ) {}
}

export type DeleteMyStudyPlanItemFeatureResponse = z.infer<
    typeof DeleteMyStudyPlanItemFeatureOutputSchema
>
