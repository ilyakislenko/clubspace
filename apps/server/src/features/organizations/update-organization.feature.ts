import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../shared/utils/optimistic-concurrency'
import { IanaTimezoneSchema } from '../platform/schemas'
import { OrganizationOutputSchema } from './schemas'

// «Настройки» of the org console: the profile form (dirty guard, sends the
// version it opened with).
export const UpdateOrganizationInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    city: z.string().trim().max(120).nullable(),
    description: z.string().trim().max(4000).nullable(),
    // A key from POST orgs/:id/logo-upload, or null to remove the logo.
    logoKey: z.string().max(255).nullable(),
    timezone: IanaTimezoneSchema,
    ...ExpectedUpdatedAtField,
})

export const UpdateOrganizationOutputSchema = OrganizationOutputSchema

export class UpdateOrganizationFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateOrganizationInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateOrganizationFeatureResponse = z.infer<typeof UpdateOrganizationOutputSchema>
