import { z } from 'zod'

import { OrgClubRowSchema } from './schemas'

// The club is found by its join code — the code the admin previews first with
// GET public/clubs/by-code/:code (same lookup).
export const InviteClubToOrganizationInputSchema = z.object({
    joinCode: z.string().trim().min(1).max(32),
})

export const InviteClubToOrganizationOutputSchema = OrgClubRowSchema

export class InviteClubToOrganizationFeature {
    constructor(
        readonly payload: z.infer<typeof InviteClubToOrganizationInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type InviteClubToOrganizationFeatureResponse = z.infer<
    typeof InviteClubToOrganizationOutputSchema
>
