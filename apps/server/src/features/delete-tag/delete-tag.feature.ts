import { z } from 'zod'

export const DeleteTagFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteTagFeature {
    constructor(
        readonly workspaceId: string,
        readonly tagId: string,
    ) {}
}

export type DeleteTagFeatureResponse = z.infer<
    typeof DeleteTagFeatureOutputSchema
>
