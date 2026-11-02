import { Feature, IFeatureHandler } from '@shelfjs/features'

import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import {
    CancelEventRegistrationFeature,
    CancelEventRegistrationFeatureResponse,
} from './cancel-event-registration.feature'

// The member gives up their place / waitlist place — only their own; the
// freed place goes to the waitlist with a push.
@Feature(CancelEventRegistrationFeature)
export class CancelEventRegistrationHandler
    implements
        IFeatureHandler<
            CancelEventRegistrationFeature,
            CancelEventRegistrationFeatureResponse
        >
{
    constructor(private readonly registrations: EventRegistrationService) {}

    async execute(f: CancelEventRegistrationFeature) {
        return this.registrations.cancelOwn({
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            registrationId: f.registrationId,
        })
    }
}
