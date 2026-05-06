import { z } from 'zod'

export const ListMyFavoritesFeatureInputSchema = z.object({})

export const ListMyFavoritesFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            videoId: z.string().uuid(),
            createdAt: z.iso.datetime(),
            video: z
                .object({
                    id: z.string().uuid(),
                    title: z.string(),
                    duration: z.number().int().nullable(),
                    thumbnailUrl: z.string().nullable(),
                    status: z.string(),
                })
                .nullable(),
        }),
    ),
})

export class ListMyFavoritesFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
    ) {}
}

export type ListMyFavoritesFeatureResponse = z.infer<
    typeof ListMyFavoritesFeatureOutputSchema
>
