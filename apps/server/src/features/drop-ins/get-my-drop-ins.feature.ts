import { z } from 'zod'

import { DropInBookingOutputSchema } from './schemas'

export const GetMyDropInsOutputSchema = z.object({
    // Whether the member may book a class in another group right now.
    canBook: z.boolean(),
    // Why not (RU, ready to show); null when canBook.
    blockedReason: z.string().nullable(),
    // Upcoming bookings, soonest first.
    bookings: z.array(DropInBookingOutputSchema),
})

export class GetMyDropInsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type GetMyDropInsFeatureResponse = z.infer<
    typeof GetMyDropInsOutputSchema
>
