import { z } from 'zod'

import { StudyPlanDetailSchema } from './schemas'

// Only the fields sent change; the range is checked after merging.
export const UpdateMyStudyPlanItemFeatureInputSchema = z.object({
    title: z.string().trim().max(255).optional(),
    note: z.string().trim().max(5000).nullable().optional(),
    startSec: z.number().int().min(0).optional(),
    endSec: z.number().int().nullable().optional(),
})

export const UpdateMyStudyPlanItemFeatureOutputSchema = StudyPlanDetailSchema

export class UpdateMyStudyPlanItemFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly planId: string,
        readonly itemId: string,
        readonly payload: z.infer<typeof UpdateMyStudyPlanItemFeatureInputSchema>,
    ) {}
}

export type UpdateMyStudyPlanItemFeatureResponse = z.infer<
    typeof UpdateMyStudyPlanItemFeatureOutputSchema
>
