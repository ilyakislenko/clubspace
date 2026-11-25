import { z } from 'zod'

import { emailSchema } from '../../shared/utils/email'
import { OrgMemberOutputSchema, OrgRoleSchema, SuccessOutputSchema } from './schemas'

// «Команда» of the org console (org admins only).

export const ListOrgMembersOutputSchema = z.object({
    data: z.array(OrgMemberOutputSchema),
})

export class ListOrgMembersFeature {
    constructor(
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListOrgMembersFeatureResponse = z.infer<typeof ListOrgMembersOutputSchema>

// Adds a person by e-mail (an account is created when missing, sign-in is
// e-mail OTP) or changes the role of someone already on the team.
export const AddOrgMemberInputSchema = z.object({
    email: emailSchema,
    role: OrgRoleSchema,
})

export const AddOrgMemberOutputSchema = OrgMemberOutputSchema

export class AddOrgMemberFeature {
    constructor(
        readonly payload: z.infer<typeof AddOrgMemberInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type AddOrgMemberFeatureResponse = z.infer<typeof AddOrgMemberOutputSchema>

export const RemoveOrgMemberOutputSchema = SuccessOutputSchema

export class RemoveOrgMemberFeature {
    constructor(
        readonly organizationId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RemoveOrgMemberFeatureResponse = z.infer<typeof RemoveOrgMemberOutputSchema>
