import { z } from 'zod'

import { ExceptionOutputSchema } from './schemas'

export const UpdateGroupExceptionFeatureInputSchema = z.object({
    slotId: z.string().uuid().nullable().optional(),
    fromDate: z.iso.date().optional(),
    untilDate: z.iso.date().optional(),
    reason: z.string().trim().min(1).max(255).nullable().optional(),
})

export const UpdateGroupExceptionFeatureOutputSchema = ExceptionOutputSchema

export class UpdateGroupExceptionFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateGroupExceptionFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly exceptionId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateGroupExceptionFeatureResponse = z.infer<
    typeof UpdateGroupExceptionFeatureOutputSchema
>
