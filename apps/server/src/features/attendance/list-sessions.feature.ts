import { z } from 'zod'

import { AttendanceSessionOutputSchema } from './schemas'

export const ListSessionsInputSchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    groupId: z.string().uuid().optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})

export const ListSessionsOutputSchema = z.object({
    data: z.array(AttendanceSessionOutputSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListSessionsFeature {
    constructor(
        readonly payload: z.infer<typeof ListSessionsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListSessionsFeatureResponse = z.infer<
    typeof ListSessionsOutputSchema
>
