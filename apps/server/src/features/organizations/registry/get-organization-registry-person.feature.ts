import { z } from 'zod'

import { OrgRegistryPodiumSchema, OrgRegistryRowSchema } from './schemas'

export const GetOrganizationRegistryPersonOutputSchema = z.object({
    personKey: z.string(),
    personName: z.string(),
    // Every belt the member clubs confirmed, newest first.
    history: z.array(OrgRegistryRowSchema),
    // Published tournament podiums, newest first.
    podiums: z.array(OrgRegistryPodiumSchema),
})

export class GetOrganizationRegistryPersonFeature {
    constructor(
        readonly organizationId: string,
        readonly personKey: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetOrganizationRegistryPersonFeatureResponse = z.infer<
    typeof GetOrganizationRegistryPersonOutputSchema
>
