import { z } from 'zod'

export const GetAttendanceOverviewInputSchema = z.object({
    days: z.coerce.number().int().positive().max(365).optional(),
})

export const GetAttendanceOverviewOutputSchema = z.object({
    days: z.number().int(),
    sessionsHeld: z.number().int(),
    totalCheckIns: z.number().int(),
    distinctAttendees: z.number().int(),
})

export class GetAttendanceOverviewFeature {
    constructor(
        readonly payload: z.infer<typeof GetAttendanceOverviewInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetAttendanceOverviewFeatureResponse = z.infer<
    typeof GetAttendanceOverviewOutputSchema
>
