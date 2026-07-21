import { z } from 'zod'

// One action applied to many videos at once from the admin library. `delete`
// mirrors the single-video delete (storage cleanup) per id; the others are set
// operations. Tags are intentionally excluded — the tag model is structured
// (primary/secondary/context), not a flat join, so it has no safe bulk form.
export const BulkVideoActionSchema = z.enum([
    'setPublic',
    'setPrivate',
    'addCategory',
    'removeCategory',
    'delete',
])
export type BulkVideoAction = z.infer<typeof BulkVideoActionSchema>

export const BulkUpdateVideosInputSchema = z.object({
    workspaceId: z.string().uuid(),
    // Bounded so a single call can't fan out into an unbounded delete loop.
    videoIds: z.array(z.string().uuid()).min(1).max(200),
    action: BulkVideoActionSchema,
    // Required for add/removeCategory; ignored otherwise.
    categoryId: z.string().uuid().optional(),
})

export const BulkUpdateVideosOutputSchema = z.object({
    // How many videos the action actually changed (skips duplicates / rows
    // that don't belong to the workspace).
    affected: z.number().int(),
})

export class BulkUpdateVideosFeature {
    constructor(
        readonly payload: z.infer<typeof BulkUpdateVideosInputSchema>,
        readonly invokerUserId: string,
    ) {}
}

export type BulkUpdateVideosFeatureResponse = z.infer<
    typeof BulkUpdateVideosOutputSchema
>
