import { z } from 'zod'

import { OrgClubRowSchema, OrgMetricsTotalsSchema } from './schemas'

// «Клубы»: active members with the glossary numbers, pending invitations as
// rows without numbers, and the totals row.
export const ListOrganizationClubsOutputSchema = z.object({
    data: z.array(OrgClubRowSchema),
    totals: OrgMetricsTotalsSchema,
    // When the numbers were computed (cached up to 10 minutes).
    computedAt: z.iso.datetime(),
})

export class ListOrganizationClubsFeature {
    constructor(
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListOrganizationClubsFeatureResponse = z.infer<
    typeof ListOrganizationClubsOutputSchema
>
