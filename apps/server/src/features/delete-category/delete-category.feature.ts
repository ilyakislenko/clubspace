import { z } from 'zod'

export const DeleteCategoryFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteCategoryFeature {
    constructor(
        readonly workspaceId: string,
        readonly categoryId: string,
    ) {}
}

export type DeleteCategoryFeatureResponse = z.infer<
    typeof DeleteCategoryFeatureOutputSchema
>
