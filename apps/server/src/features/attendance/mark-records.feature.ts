import { z } from 'zod'

import { SessionRosterOutputSchema } from './schemas'

export const MarkRecordsInputSchema = z.object({
    userIds: z.array(z.string().uuid()).min(1).max(200),
})
export const MarkRecordsOutputSchema = SessionRosterOutputSchema

export class MarkRecordsFeature {
    constructor(
        readonly payload: z.infer<typeof MarkRecordsInputSchema>,
        readonly workspaceId: string,
        readonly sessionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type MarkRecordsFeatureResponse = z.infer<
    typeof MarkRecordsOutputSchema
>
