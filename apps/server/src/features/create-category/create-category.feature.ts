import { z } from 'zod'

export const CreateCategoryFeatureInputSchema = z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    parentId: z.string().uuid().nullable().optional(),
    order: z.number().int().optional(),
})

export const CreateCategoryFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    parentId: z.string().uuid().nullable().optional(),
    order: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class CreateCategoryFeature {
    constructor(
        readonly payload: z.infer<typeof CreateCategoryFeatureInputSchema>,
        readonly workspaceId: string,
    ) {}
}

export type CreateCategoryFeatureResponse = z.infer<
    typeof CreateCategoryFeatureOutputSchema
>
