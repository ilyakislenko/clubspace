import { z } from 'zod'

import { ClassBookingOutputSchema } from './schemas'

export const GetMyClassBookingsOutputSchema = z.object({
    // Classes that haven't ended yet, soonest first.
    upcoming: z.array(ClassBookingOutputSchema),
    // Finished / cancelled bookings of the last 60 days, newest first — with
    // the late cancels and no-shows and what they burned.
    history: z.array(ClassBookingOutputSchema),
})

export class GetMyClassBookingsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type GetMyClassBookingsFeatureResponse = z.infer<
    typeof GetMyClassBookingsOutputSchema
>
