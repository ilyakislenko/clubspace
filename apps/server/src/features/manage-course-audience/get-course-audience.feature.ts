import { z } from 'zod'

import { CourseAudienceOutputSchema } from './schemas'

export const GetCourseAudienceFeatureOutputSchema = CourseAudienceOutputSchema

export class GetCourseAudienceFeature {
    constructor(
        readonly workspaceId: string,
        readonly courseId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetCourseAudienceFeatureResponse = z.infer<
    typeof GetCourseAudienceFeatureOutputSchema
>
