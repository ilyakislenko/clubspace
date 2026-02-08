import { z } from 'zod'

export const UpdateTagFeatureInputSchema = z.object({
    type: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
})

export const UpdateTagFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    type: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class UpdateTagFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateTagFeatureInputSchema>,
        readonly workspaceId: string,
        readonly tagId: string,
    ) {}
}

export type UpdateTagFeatureResponse = z.infer<
    typeof UpdateTagFeatureOutputSchema
>
