import { z } from 'zod'

import { EventOutputSchema } from './schemas'

export const ListWorkspaceEventsFeatureInputSchema = z.object({
    // Inclusive ISO date range. Both optional — defaults to "from today
    // for 60 days" inside the handler so a no-arg call gives mobile a
    // reasonable feed without forcing the client to compute dates.
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
})

export const ListWorkspaceEventsFeatureOutputSchema = z.object({
    data: z.array(EventOutputSchema),
})

export class ListWorkspaceEventsFeature {
    constructor(
        readonly payload: z.infer<
            typeof ListWorkspaceEventsFeatureInputSchema
        >,
        readonly workspaceId: string,
    ) {}
}

export type ListWorkspaceEventsFeatureResponse = z.infer<
    typeof ListWorkspaceEventsFeatureOutputSchema
>
