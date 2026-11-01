import { z } from 'zod'

import { SessionRosterOutputSchema } from './schemas'

// Moves an existing visit to another of the member's abonements eligible for
// this class (the roster's abonementOptions).
export const ChangeRecordAbonementInputSchema = z.object({
    subscriptionId: z.string().uuid(),
})
export const ChangeRecordAbonementOutputSchema = SessionRosterOutputSchema

export class ChangeRecordAbonementFeature {
    constructor(
        readonly payload: z.infer<typeof ChangeRecordAbonementInputSchema>,
        readonly workspaceId: string,
        readonly sessionId: string,
        // The marked member whose visit moves.
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ChangeRecordAbonementFeatureResponse = z.infer<
    typeof ChangeRecordAbonementOutputSchema
>
