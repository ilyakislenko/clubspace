import { z } from 'zod'

import type { ClassOccurrenceParams } from './get-class-occurrence.feature'
import { ClassOccurrenceOutputSchema } from './schemas'

export const RemoveClassBookingOutputSchema = ClassOccurrenceOutputSchema

export class RemoveClassBookingFeature {
    constructor(
        readonly params: ClassOccurrenceParams,
        readonly bookingId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RemoveClassBookingFeatureResponse = z.infer<
    typeof RemoveClassBookingOutputSchema
>
