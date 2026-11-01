import { z } from 'zod'

import { ClassBookingOutputSchema } from './schemas'

export const CancelClassBookingOutputSchema = ClassBookingOutputSchema

export class CancelClassBookingFeature {
    constructor(
        readonly workspaceId: string,
        readonly bookingId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CancelClassBookingFeatureResponse = z.infer<
    typeof CancelClassBookingOutputSchema
>
