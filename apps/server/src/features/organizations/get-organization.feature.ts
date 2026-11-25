import { z } from 'zod'

import { OrganizationOutputSchema } from './schemas'

export const GetOrganizationOutputSchema = OrganizationOutputSchema

export class GetOrganizationFeature {
    constructor(
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetOrganizationFeatureResponse = z.infer<typeof GetOrganizationOutputSchema>
