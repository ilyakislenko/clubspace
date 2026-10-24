import { z } from 'zod'

import { AttendanceSessionOutputSchema } from './schemas'

export const GetAttendanceSessionOutputSchema = AttendanceSessionOutputSchema

export class GetAttendanceSessionFeature {
    constructor(
        readonly workspaceId: string,
        readonly sessionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetAttendanceSessionFeatureResponse = z.infer<
    typeof GetAttendanceSessionOutputSchema
>
