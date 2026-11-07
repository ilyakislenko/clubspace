import { z } from 'zod'

import { StudyPlanDetailSchema } from './schemas'

// From a bookmark / A–B segment, a chapter or the current moment — the app
// copies the moment, its end and a title; the server only checks them.
export const AddMyStudyPlanItemFeatureInputSchema = z.object({
    videoId: z.string().uuid(),
    startSec: z.number().int().min(0),
    // Must be > startSec when set (checked in the handler).
    endSec: z.number().int().nullable().default(null),
    title: z.string().trim().max(255).default(''),
    note: z.string().trim().max(5000).nullable().default(null),
})

export const AddMyStudyPlanItemFeatureOutputSchema = StudyPlanDetailSchema

export class AddMyStudyPlanItemFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly planId: string,
        readonly payload: z.infer<typeof AddMyStudyPlanItemFeatureInputSchema>,
    ) {}
}

export type AddMyStudyPlanItemFeatureResponse = z.infer<
    typeof AddMyStudyPlanItemFeatureOutputSchema
>
