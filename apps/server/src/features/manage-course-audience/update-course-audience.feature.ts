import { z } from 'zod'

import { CourseAudienceOutputSchema } from './schemas'

// Replaces the whole audience. All empty = open to the whole club.
export const UpdateCourseAudienceFeatureInputSchema = z.object({
    groupIds: z.array(z.string().uuid()).max(100),
    // Members of any group of these directions (hidden from the rest, like
    // groups). Omitted = none.
    directionIds: z.array(z.string().uuid()).max(50).default([]),
    // Minimum level, at most one per ladder.
    rankLevelIds: z.array(z.string().uuid()).max(20),
    planIds: z.array(z.string().uuid()).max(100),
})

export const UpdateCourseAudienceFeatureOutputSchema = CourseAudienceOutputSchema

export class UpdateCourseAudienceFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateCourseAudienceFeatureInputSchema>,
        readonly workspaceId: string,
        readonly courseId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateCourseAudienceFeatureResponse = z.infer<
    typeof UpdateCourseAudienceFeatureOutputSchema
>
