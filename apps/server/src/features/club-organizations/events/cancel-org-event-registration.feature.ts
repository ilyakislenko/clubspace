import { z } from 'zod'

import { OrgEventRegistrationRefOutputSchema } from './register-for-org-event.feature'

export const CancelOrgEventRegistrationOutputSchema = OrgEventRegistrationRefOutputSchema

export class CancelOrgEventRegistrationFeature {
    constructor(
        readonly workspaceId: string,
        readonly registrationId: string,
        readonly invokerUserId: string,
        readonly guardianId: string | null,
    ) {}
}
export type CancelOrgEventRegistrationFeatureResponse = z.infer<
    typeof CancelOrgEventRegistrationOutputSchema
>
