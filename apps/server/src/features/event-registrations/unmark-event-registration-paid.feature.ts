import { z } from 'zod'

import { EventRegistrantSchema } from './schemas'

export const UnmarkEventRegistrationPaidOutputSchema = EventRegistrantSchema

export class UnmarkEventRegistrationPaidFeature {
    constructor(
        readonly workspaceId: string,
        readonly registrationId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UnmarkEventRegistrationPaidFeatureResponse = z.infer<
    typeof UnmarkEventRegistrationPaidOutputSchema
>
