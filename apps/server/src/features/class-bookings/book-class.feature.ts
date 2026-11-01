import { z } from 'zod'

import { ClassBookingOutputSchema } from './schemas'

export const BookClassInputSchema = z.object({
    slotId: z.string().uuid(),
    // Slot-local calendar date of the class, yyyy-mm-dd.
    sessionDate: z.iso.date(),
})

export const BookClassOutputSchema = ClassBookingOutputSchema

export class BookClassFeature {
    constructor(
        readonly payload: z.infer<typeof BookClassInputSchema>,
        readonly workspaceId: string,
        // The member the place is for (the child when a guardian acts as it).
        readonly invokerUserId: string,
        // Who pressed the button: the guardian under act-as, else the member.
        readonly actorUserId: string,
    ) {}
}

export type BookClassFeatureResponse = z.infer<typeof BookClassOutputSchema>
