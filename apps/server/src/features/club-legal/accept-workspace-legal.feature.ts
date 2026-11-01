import { z } from 'zod'

import { ClubLegalViewSchema } from './schemas'

export const AcceptWorkspaceLegalInputSchema = z.object({
    // The editions the owner was shown (GET /workspaces/:id/billing → legal).
    offerVersion: z.string().trim().min(1).max(64),
    dpaVersion: z.string().trim().min(1).max(64),
})

export const AcceptWorkspaceLegalOutputSchema = ClubLegalViewSchema

export class AcceptWorkspaceLegalFeature {
    constructor(
        readonly payload: z.infer<typeof AcceptWorkspaceLegalInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
        // Evidence of where it was accepted, stored on the record.
        readonly ip: string | null,
        readonly userAgent: string | null,
    ) {}
}

export type AcceptWorkspaceLegalFeatureResponse = z.infer<
    typeof AcceptWorkspaceLegalOutputSchema
>
