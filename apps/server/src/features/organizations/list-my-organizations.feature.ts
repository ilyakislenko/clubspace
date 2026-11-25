import { z } from 'zod'

import { OrgRoleSchema, OrgTypeSchema } from './schemas'

// The admin's club picker «Федерации» block and the sign-in routing of a
// federation-only account (design §4.1): the orgs the caller is staff of.
export const ListMyOrganizationsOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            name: z.string(),
            type: OrgTypeSchema,
            city: z.string().nullable(),
            logoUrl: z.string().nullable(),
            role: OrgRoleSchema,
        }),
    ),
})

export class ListMyOrganizationsFeature {
    constructor(readonly invokerUserId: string) {}
}

export type ListMyOrganizationsFeatureResponse = z.infer<typeof ListMyOrganizationsOutputSchema>
