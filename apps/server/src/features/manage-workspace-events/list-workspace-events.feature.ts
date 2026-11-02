import { z } from 'zod'

import { EventRegistrationSummarySchema } from '../event-registrations/schemas'
import { EventOutputSchema } from './schemas'

export const ListWorkspaceEventsFeatureInputSchema = z.object({
    // Inclusive ISO date range. Both optional — defaults to "from today
    // for 60 days" inside the handler so a no-arg call gives mobile a
    // reasonable feed without forcing the client to compute dates.
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    // Only events tagged with this direction (the schedule filter).
    directionId: z.string().uuid().optional(),
})

// An event plus its places when members register for it (a price or a
// limit); null for an open event.
export const EventListItemSchema = EventOutputSchema.extend({
    registration: EventRegistrationSummarySchema.nullable(),
})

export const ListWorkspaceEventsFeatureOutputSchema = z.object({
    data: z.array(EventListItemSchema),
})

export class ListWorkspaceEventsFeature {
    constructor(
        readonly payload: z.infer<
            typeof ListWorkspaceEventsFeatureInputSchema
        >,
        readonly workspaceId: string,
        // Whose registrations `registration.mine` shows (the child under
        // act-as).
        readonly invokerUserId: string,
    ) {}
}

export type ListWorkspaceEventsFeatureResponse = z.infer<
    typeof ListWorkspaceEventsFeatureOutputSchema
>
