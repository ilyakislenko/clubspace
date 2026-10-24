import { z } from 'zod'

export const CancelDropInOutputSchema = z.object({
    status: z.literal('cancelled'),
})

export class CancelDropInFeature {
    constructor(
        readonly workspaceId: string,
        readonly bookingId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CancelDropInFeatureResponse = z.infer<
    typeof CancelDropInOutputSchema
>
