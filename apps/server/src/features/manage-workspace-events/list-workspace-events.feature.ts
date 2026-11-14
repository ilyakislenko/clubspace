import { z } from 'zod'

import { EventRegistrationSummarySchema } from '../event-registrations/schemas'
import { EventOutputSchema } from './schemas'

// The longest window one call may ask for (a year, leap day included).
export const EVENTS_MAX_RANGE_DAYS = 366

export const ListWorkspaceEventsFeatureInputSchema = z.object({
    // Inclusive ISO date range. Both optional — defaults to "from today
    // for 60 days" inside the handler so a no-arg call gives mobile a
    // reasonable feed without forcing the client to compute dates. `to`
    // before `from`, or more than EVENTS_MAX_RANGE_DAYS apart, is a 400.
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
