import { z } from 'zod'

export const CreateTagFeatureInputSchema = z.object({
    type: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().nullable().optional(),
})

export const CreateTagFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    type: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class CreateTagFeature {
    constructor(
        readonly payload: z.infer<typeof CreateTagFeatureInputSchema>,
        readonly workspaceId: string,
    ) {}
}

export type CreateTagFeatureResponse = z.infer<
    typeof CreateTagFeatureOutputSchema
>
