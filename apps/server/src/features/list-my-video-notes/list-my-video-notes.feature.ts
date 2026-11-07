import { z } from 'zod'

import { MyVideoBookmarkSchema } from '../manage-my-video-bookmarks/schemas'

export const ListMyVideoNotesFeatureInputSchema = z.object({
    // Case-insensitive substring over video title, note text, bookmark
    // label and bookmark note.
    q: z.string().max(200).optional(),
})

export const ListMyVideoNotesFeatureOutputSchema = z.object({
    items: z.array(
        z.object({
            video: z.object({
                id: z.string().uuid(),
                title: z.string(),
                thumbnailUrl: z.string().nullable(),
                duration: z.number().int().nullable(),
            }),
            course: z
                .object({ id: z.string().uuid(), title: z.string() })
                .nullable(),
            note: z
                .object({ text: z.string(), updatedAt: z.iso.datetime() })
                .nullable(),
            bookmarks: z.array(MyVideoBookmarkSchema),
        }),
    ),
})

export class ListMyVideoNotesFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly payload: z.infer<typeof ListMyVideoNotesFeatureInputSchema>,
        // Staff see every course (drafts, all audiences) when we pick the
        // course a video belongs to — same rule as get-playlist.
        readonly isStaff: boolean,
    ) {}
}

export type ListMyVideoNotesFeatureResponse = z.infer<
    typeof ListMyVideoNotesFeatureOutputSchema
>
