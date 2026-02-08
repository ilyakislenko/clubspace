import { z } from 'zod'

export const ListCategoriesFeatureInputSchema = z.object({
    parentId: z.string().uuid().nullable().optional(),
})

export const ListCategoriesFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            workspaceId: z.string().uuid(),
            name: z.string(),
            slug: z.string(),
            parentId: z.string().uuid().nullable().optional(),
            order: z.number().int(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
        }),
    ),
})

export class ListCategoriesFeature {
    constructor(
        readonly payload: z.infer<typeof ListCategoriesFeatureInputSchema>,
        readonly workspaceId: string,
    ) {}
}

export type ListCategoriesFeatureResponse = z.infer<
    typeof ListCategoriesFeatureOutputSchema
>
