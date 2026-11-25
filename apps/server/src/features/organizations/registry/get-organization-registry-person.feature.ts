import { z } from 'zod'

import { OrgRegistryRowSchema } from './schemas'

export const GetOrganizationRegistryPersonOutputSchema = z.object({
    personKey: z.string(),
    personName: z.string(),
    // Every belt the member clubs confirmed, newest first.
    history: z.array(OrgRegistryRowSchema),
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
