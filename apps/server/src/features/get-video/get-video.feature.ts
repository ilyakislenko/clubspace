import { z } from 'zod'

export const GetVideoFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
})

export const GetVideoFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    url: z.string(),
    duration: z.number().int().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
})

export class GetVideoFeature {
    constructor(
        readonly payload: z.infer<typeof GetVideoFeatureInputSchema>,
        readonly videoId: string,
    ) {}
}

export type GetVideoFeatureResponse = z.infer<typeof GetVideoFeatureOutputSchema>
