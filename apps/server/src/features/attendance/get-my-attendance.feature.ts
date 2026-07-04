import { z } from 'zod'

import { AttendanceSessionOutputSchema } from './schemas'

export const GetMyAttendanceInputSchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})

export const GetMyAttendanceOutputSchema = z.object({
    sessions: z.array(AttendanceSessionOutputSchema),
    total: z.number().int(), // lifetime records in this workspace
    rangeCount: z.number().int(), // records within the requested window
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class GetMyAttendanceFeature {
    constructor(
        readonly payload: z.infer<typeof GetMyAttendanceInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMyAttendanceFeatureResponse = z.infer<
    typeof GetMyAttendanceOutputSchema
>
