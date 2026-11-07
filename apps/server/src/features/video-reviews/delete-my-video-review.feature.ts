import { z } from 'zod'

export const DeleteMyVideoReviewFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteMyVideoReviewFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly requestId: string,
    ) {}
}

export type DeleteMyVideoReviewFeatureResponse = z.infer<
    typeof DeleteMyVideoReviewFeatureOutputSchema
>
