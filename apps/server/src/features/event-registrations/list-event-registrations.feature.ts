import { z } from 'zod'

import { EventRegistrantSchema } from './schemas'

export const ListEventRegistrationsOutputSchema = z.object({
    eventId: z.string().uuid(),
    // null = no limit / free.
    capacity: z.number().int().nullable(),
    price: z.number().int().nullable(),
    currency: z.string(),
    booked: z.number().int(),
    waitlist: z.number().int(),
    // Tickets marked paid (cancelled ones included — the money was taken).
    paid: z.object({ count: z.number().int(), amount: z.number().int() }),
    // Places first, then the waitlist in its order, then cancelled.
    data: z.array(EventRegistrantSchema),
})

export class ListEventRegistrationsFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListEventRegistrationsFeatureResponse = z.infer<
    typeof ListEventRegistrationsOutputSchema
>
