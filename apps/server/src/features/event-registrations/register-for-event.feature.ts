import { z } from 'zod'

import { EventRegistrationOutputSchema } from './schemas'

export const RegisterForEventOutputSchema = EventRegistrationOutputSchema

export class RegisterForEventFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        // The member the place is for (the child when a guardian acts as it).
        readonly invokerUserId: string,
        // Who pressed the button: the guardian under act-as, else the member.
        readonly actorUserId: string,
    ) {}
}

export type RegisterForEventFeatureResponse = z.infer<
    typeof RegisterForEventOutputSchema
>
