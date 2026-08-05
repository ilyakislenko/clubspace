import { z } from 'zod'

export const MovePlaylistVideoFeatureInputSchema = z
    .object({
        /** Video that should end up immediately BEFORE the moved one. null = move to the very start. */
        afterId: z.string().uuid().nullable().optional(),
        /** Video that should end up immediately AFTER the moved one. null = move to the very end. */
        beforeId: z.string().uuid().nullable().optional(),
    })
    .refine(
        (data) => data.afterId !== undefined || data.beforeId !== undefined,
        {
            message: 'Укажите afterId, beforeId или оба',
        },
    )

export const MovePlaylistVideoFeatureOutputSchema = z.object({
    videoId: z.string().uuid(),
    order: z.number().int(),
})

export class MovePlaylistVideoFeature {
    constructor(
        readonly payload: z.infer<typeof MovePlaylistVideoFeatureInputSchema>,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly videoId: string,
        readonly invokerUserId: string,
    ) {}
}

export type MovePlaylistVideoFeatureResponse = z.infer<
    typeof MovePlaylistVideoFeatureOutputSchema
>
