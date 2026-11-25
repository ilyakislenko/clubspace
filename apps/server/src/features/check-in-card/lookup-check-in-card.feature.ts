import { z } from 'zod'

import { CheckInCardLookupSchema } from './schemas'

export const LookupCheckInCardInputSchema = z.object({
    // The raw QR text: `CS1.<userId>.<mac>` (56 characters today).
    card: z.string().trim().min(1).max(120),
})
export const LookupCheckInCardOutputSchema = CheckInCardLookupSchema

// Resolves a scanned card for a session the caller may mark. Read-only: the
// app then marks through the existing records endpoint.
export class LookupCheckInCardFeature {
    constructor(
        readonly payload: z.infer<typeof LookupCheckInCardInputSchema>,
        readonly workspaceId: string,
        readonly sessionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type LookupCheckInCardFeatureResponse = z.infer<
    typeof LookupCheckInCardOutputSchema
>
