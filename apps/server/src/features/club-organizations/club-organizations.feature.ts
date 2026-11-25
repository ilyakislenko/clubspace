import { z } from 'zod'

import { ClubOrganizationLinkSchema, OrgSharingPatchSchema } from './schemas'

// Club side of the federation hub (CLUB_ADMINS; the club's own data-sharing
// decisions). docs/design/2026-11-26-federation-hub-mvp.md §3.3.

export const ListClubOrganizationsOutputSchema = z.object({
    data: z.array(ClubOrganizationLinkSchema),
})

export class ListClubOrganizationsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListClubOrganizationsFeatureResponse = z.infer<
    typeof ListClubOrganizationsOutputSchema
>

// The owner's «Принять», with the toggles as the card showed them.
export const AcceptOrganizationInviteInputSchema = z.object({
    sharing: OrgSharingPatchSchema.optional(),
})

export const ClubOrganizationLinkOutputSchema = ClubOrganizationLinkSchema

export type ClubOrganizationLinkResponse = z.infer<typeof ClubOrganizationLinkOutputSchema>

export class AcceptOrganizationInviteFeature {
    constructor(
        readonly payload: z.infer<typeof AcceptOrganizationInviteInputSchema>,
        readonly workspaceId: string,
        readonly linkId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export class DeclineOrganizationInviteFeature {
    constructor(
        readonly workspaceId: string,
        readonly linkId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export const UpdateOrganizationSharingInputSchema = OrgSharingPatchSchema

export class UpdateOrganizationSharingFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateOrganizationSharingInputSchema>,
        readonly workspaceId: string,
        readonly linkId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export class LeaveOrganizationFeature {
    constructor(
        readonly workspaceId: string,
        readonly linkId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
