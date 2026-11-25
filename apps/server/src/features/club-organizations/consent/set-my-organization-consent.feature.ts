import { z } from 'zod'

import { MyClubOrganizationOutputSchema } from './schemas'

export const SetMyOrganizationConsentInputSchema = z.object({
    // true = consent (idempotent), false = withdraw; the org stops seeing the
    // person at once.
    granted: z.boolean(),
})
export const SetMyOrganizationConsentOutputSchema = MyClubOrganizationOutputSchema

export class SetMyOrganizationConsentFeature {
    constructor(
        readonly payload: z.infer<typeof SetMyOrganizationConsentInputSchema>,
        readonly workspaceId: string,
        readonly organizationId: string,
        // The person; a child when a guardian acts for it (X-Act-As).
        readonly userId: string,
        // The guardian acting for the child, else null.
        readonly guardianId: string | null,
        readonly ip: string | null,
        readonly userAgent: string | null,
    ) {}
}
export type SetMyOrganizationConsentFeatureResponse = z.infer<
    typeof SetMyOrganizationConsentOutputSchema
>
