import { z } from 'zod'

export const SetVideoFavoriteFeatureInputSchema = z.object({
    favorite: z.boolean(),
})

export const SetVideoFavoriteFeatureOutputSchema = z.object({
    videoId: z.string().uuid(),
    favorite: z.boolean(),
})

export class SetVideoFavoriteFeature {
    constructor(
        readonly userId: string,
        readonly videoId: string,
        readonly payload: z.infer<typeof SetVideoFavoriteFeatureInputSchema>,
    ) {}
}

export type SetVideoFavoriteFeatureResponse = z.infer<
    typeof SetVideoFavoriteFeatureOutputSchema
>
