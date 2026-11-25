import { z } from 'zod'

import { OrgRegistryRowSchema } from './schemas'

export const SearchOrganizationRegistryInputSchema = z.object({
    // Part of a name or surname.
    q: z.string().trim().max(100).optional(),
    // One member club only.
    clubId: z.string().uuid().optional(),
    // Only belts copied from this level of the federation standard.
    templateLevelId: z.string().uuid().optional(),
    // Promotion dates in the org's zone, inclusive.
    awardedFrom: z.iso.date().optional(),
    awardedTo: z.iso.date().optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})
export const SearchOrganizationRegistryOutputSchema = z.object({
    data: z.array(OrgRegistryRowSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class SearchOrganizationRegistryFeature {
    constructor(
        readonly payload: z.infer<typeof SearchOrganizationRegistryInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type SearchOrganizationRegistryFeatureResponse = z.infer<
    typeof SearchOrganizationRegistryOutputSchema
>
