import { z } from 'zod'

import { DropInBookingOutputSchema } from './schemas'

export const CreateDropInInputSchema = z.object({
    slotId: z.string().uuid(),
    // Slot-local calendar date of the class, yyyy-mm-dd.
    sessionDate: z.iso.date(),
})

export const CreateDropInOutputSchema = DropInBookingOutputSchema

export class CreateDropInFeature {
    constructor(
        readonly payload: z.infer<typeof CreateDropInInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CreateDropInFeatureResponse = z.infer<
    typeof CreateDropInOutputSchema
>
