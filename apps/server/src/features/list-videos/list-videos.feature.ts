import { z } from 'zod'

export const ListVideosFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    curPage: z.number().int().positive().optional(),
    perPage: z.number().int().positive().optional(),
})

export const ListVideosFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            workspaceId: z.string().uuid(),
            title: z.string(),
            description: z.string().nullable().optional(),
            status: z.string(),
            url: z.string(),
            duration: z.number().int().nullable().optional(),
            thumbnailUrl: z.string().nullable().optional(),
            errorMessage: z.string().nullable().optional(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
        }),
    ),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListVideosFeature {
    constructor(
        readonly payload: z.infer<typeof ListVideosFeatureInputSchema>,
    ) {}
}

export type ListVideosFeatureResponse = z.infer<
    typeof ListVideosFeatureOutputSchema
>
