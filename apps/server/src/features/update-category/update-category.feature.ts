import { z } from 'zod'

export const UpdateCategoryFeatureInputSchema = z.object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    parentId: z.string().uuid().nullable().optional(),
    order: z.number().int().optional(),
})

export const UpdateCategoryFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    parentId: z.string().uuid().nullable().optional(),
    order: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class UpdateCategoryFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateCategoryFeatureInputSchema>,
        readonly workspaceId: string,
        readonly categoryId: string,
    ) {}
}

export type UpdateCategoryFeatureResponse = z.infer<
    typeof UpdateCategoryFeatureOutputSchema
>
