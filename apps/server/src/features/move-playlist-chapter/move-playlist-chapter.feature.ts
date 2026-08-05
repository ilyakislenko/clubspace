import { z } from 'zod'

export const MovePlaylistChapterFeatureInputSchema = z
    .object({
        afterChapterId: z.string().uuid().nullable().optional(),
        beforeChapterId: z.string().uuid().nullable().optional(),
    })
    .refine(
        (data) =>
            data.afterChapterId !== undefined ||
            data.beforeChapterId !== undefined,
        { message: 'Укажите afterChapterId, beforeChapterId или оба' },
    )

export const MovePlaylistChapterFeatureOutputSchema = z.object({
    chapterId: z.string().uuid(),
    order: z.number().int(),
})

export class MovePlaylistChapterFeature {
    constructor(
        readonly payload: z.infer<
            typeof MovePlaylistChapterFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly chapterId: string,
        readonly invokerUserId: string,
    ) {}
}

export type MovePlaylistChapterFeatureResponse = z.infer<
    typeof MovePlaylistChapterFeatureOutputSchema
>
