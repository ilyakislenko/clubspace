import { z } from 'zod'

import { AttendanceSessionOutputSchema } from './schemas'

// Staff-facing view of ONE member's attendance history (the member's own view
// is get-my-attendance). Same shape; the target member is a route param.
export const GetMemberAttendanceInputSchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})

export const GetMemberAttendanceOutputSchema = z.object({
    sessions: z.array(AttendanceSessionOutputSchema),
    total: z.number().int(), // lifetime records in this workspace
    rangeCount: z.number().int(), // records within the requested window
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class GetMemberAttendanceFeature {
    constructor(
        readonly payload: z.infer<typeof GetMemberAttendanceInputSchema>,
        readonly workspaceId: string,
        readonly memberUserId: string,
    ) {}
}

export type GetMemberAttendanceFeatureResponse = z.infer<
    typeof GetMemberAttendanceOutputSchema
>
