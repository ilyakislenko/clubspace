import { z } from 'zod'

import { MIN_QUERY_LENGTH } from './search-videos-utils'

export const SearchVideosFeatureInputSchema = z.object({
    // Matched case-insensitively, literally (no wildcards).
    q: z.string().trim().min(MIN_QUERY_LENGTH).max(100),
})

const HighlightSchema = z.object({
    start: z.number().int(),
    length: z.number().int(),
})

export const SearchVideosFeatureOutputSchema = z.object({
    query: z.string(),
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
            // The hit in the video title, for highlighting; null = no title hit.
            titleHighlight: HighlightSchema.nullable(),
            chapterHits: z.number().int(),
            // Cues of the transcript (and its Russian translation) that match.
            speechHits: z.number().int(),
            // The first few moments, in time order.
            moments: z.array(
                z.object({
                    atSec: z.number().int(),
                    kind: z.enum(['chapter', 'speech', 'speechRu']),
                    snippet: z.string(),
                    // Offsets of the hit in `snippet`.
                    highlight: HighlightSchema.nullable(),
                }),
            ),
        }),
    ),
})

export class SearchVideosFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly payload: z.infer<typeof SearchVideosFeatureInputSchema>,
        // Staff see every course (drafts, all audiences) when we pick the
        // course a video belongs to — same rule as list-my-video-notes.
        readonly isStaff: boolean,
    ) {}
}

export type SearchVideosFeatureResponse = z.infer<
    typeof SearchVideosFeatureOutputSchema
>
