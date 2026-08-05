import { z } from 'zod'

import { ExceptionOutputSchema } from './schemas'

export const CreateGroupExceptionFeatureInputSchema = z
    .object({
        slotId: z.string().uuid().nullable().optional(),
        fromDate: z.iso.date(),
        untilDate: z.iso.date(),
        reason: z.string().trim().min(1).max(255).nullable().optional(),
    })
    .refine((d) => d.fromDate <= d.untilDate, {
        message: 'Дата «с» должна быть не позже даты «по»',
        path: ['fromDate'],
    })

export const CreateGroupExceptionFeatureOutputSchema = ExceptionOutputSchema

export class CreateGroupExceptionFeature {
    constructor(
        readonly payload: z.infer<typeof CreateGroupExceptionFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateGroupExceptionFeatureResponse = z.infer<
    typeof CreateGroupExceptionFeatureOutputSchema
>
