import { z } from 'zod'

export const DeleteAccountFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteAccountFeature {
    constructor(readonly userId: string) {}
}

export type DeleteAccountFeatureResponse = z.infer<
    typeof DeleteAccountFeatureOutputSchema
>
