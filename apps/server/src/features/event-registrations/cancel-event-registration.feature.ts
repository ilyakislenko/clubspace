import { z } from 'zod'

import { EventRegistrationOutputSchema } from './schemas'

export const CancelEventRegistrationOutputSchema = EventRegistrationOutputSchema

export class CancelEventRegistrationFeature {
    constructor(
        readonly workspaceId: string,
        readonly registrationId: string,
        // The member whose registration it must be (the child under act-as).
        readonly invokerUserId: string,
    ) {}
}

export type CancelEventRegistrationFeatureResponse = z.infer<
    typeof CancelEventRegistrationOutputSchema
>
