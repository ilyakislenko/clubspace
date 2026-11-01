import { z } from 'zod'

import type { ClassOccurrenceParams } from './get-class-occurrence.feature'
import { ClassOccurrenceOutputSchema } from './schemas'

export const AddClassBookingInputSchema = z.object({
    userId: z.string().uuid(),
})

export const AddClassBookingOutputSchema = ClassOccurrenceOutputSchema

export class AddClassBookingFeature {
    constructor(
        readonly params: ClassOccurrenceParams,
        readonly payload: z.infer<typeof AddClassBookingInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type AddClassBookingFeatureResponse = z.infer<
    typeof AddClassBookingOutputSchema
>
