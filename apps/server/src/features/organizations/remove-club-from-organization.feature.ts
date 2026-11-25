import { z } from 'zod'

import { SuccessOutputSchema } from './schemas'

// Revokes a pending invitation or excludes an active club (status REMOVED;
// a later invite reuses the row).
export const RemoveClubFromOrganizationOutputSchema = SuccessOutputSchema

export class RemoveClubFromOrganizationFeature {
    constructor(
        readonly organizationId: string,
        readonly linkId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RemoveClubFromOrganizationFeatureResponse = z.infer<
    typeof RemoveClubFromOrganizationOutputSchema
>
