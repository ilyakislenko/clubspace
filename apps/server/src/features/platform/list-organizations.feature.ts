import { z } from 'zod'

import { PlatformOrganizationSchema } from './create-organization.feature'

export const ListPlatformOrganizationsOutputSchema = z.object({
    data: z.array(PlatformOrganizationSchema),
})

export class ListPlatformOrganizationsFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListPlatformOrganizationsFeatureResponse = z.infer<
    typeof ListPlatformOrganizationsOutputSchema
>
