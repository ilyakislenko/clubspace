import { z } from 'zod'

import type { ClassOccurrenceParams } from './get-class-occurrence.feature'
import { ClassOccurrenceOutputSchema } from './schemas'

export const SetClassCapacityInputSchema = z.object({
    // Spots for this date only; null = back to the slot's / group's.
    capacity: z.number().int().min(1).max(1000).nullable(),
})

export const SetClassCapacityOutputSchema = ClassOccurrenceOutputSchema

export class SetClassCapacityFeature {
    constructor(
        readonly params: ClassOccurrenceParams,
        readonly payload: z.infer<typeof SetClassCapacityInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type SetClassCapacityFeatureResponse = z.infer<
    typeof SetClassCapacityOutputSchema
>
