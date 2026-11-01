import { z } from 'zod'

import { SessionRosterOutputSchema } from './schemas'

export const MarkRecordsInputSchema = z.object({
    userIds: z.array(z.string().uuid()).min(1).max(200),
    // Per-member override of the abonement the visit is spent on (default =
    // the visit precedence). Must be eligible for that member and session.
    abonements: z
        .array(
            z.object({
                userId: z.string().uuid(),
                subscriptionId: z.string().uuid(),
            }),
        )
        .max(500)
        .optional(),
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
