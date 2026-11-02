import { Feature, IFeatureHandler } from '@shelfjs/features'

import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import {
    RegisterForEventFeature,
    RegisterForEventFeatureResponse,
} from './register-for-event.feature'

// Any active member registers for an event with a price or a limit of places
// (a guardian for a child via X-Act-As): a place, or a waitlist place when it
// is full. All rules live in EventRegistrationService.register.
@Feature(RegisterForEventFeature)
export class RegisterForEventHandler
    implements
        IFeatureHandler<RegisterForEventFeature, RegisterForEventFeatureResponse>
{
    constructor(private readonly registrations: EventRegistrationService) {}

    async execute(f: RegisterForEventFeature) {
        return this.registrations.register({
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            userId: f.invokerUserId,
            actorId: f.actorUserId,
        })
    }
}
