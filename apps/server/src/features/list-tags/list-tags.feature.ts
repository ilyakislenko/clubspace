import { z } from 'zod'

export const ListTagsFeatureInputSchema = z.object({
    type: z.string().optional(),
})

export const ListTagsFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            workspaceId: z.string().uuid(),
            type: z.string(),
            name: z.string(),
            slug: z.string(),
            description: z.string().nullable().optional(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
        }),
    ),
})

export class ListTagsFeature {
    constructor(
        readonly payload: z.infer<typeof ListTagsFeatureInputSchema>,
        readonly workspaceId: string,
    ) {}
}

export type ListTagsFeatureResponse = z.infer<typeof ListTagsFeatureOutputSchema>
