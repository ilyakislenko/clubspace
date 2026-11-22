import { z } from 'zod'

// «Главы и субтитры» on the admin video page: what the worker has made from
// the lesson's speech and picture, and remaking it.

const SourceCountsSchema = z.object({ manual: z.number().int(), auto: z.number().int() })

export const GetVideoTextStatusFeatureOutputSchema = z.object({
    // The worker only works on ready videos.
    videoStatus: z.string(),
    // When the chapter scan last finished (null: never, or cleared to redo).
    chaptersScannedAt: z.iso.datetime().nullable(),
    transcript: z
        .object({
            // Spoken language ('und' when Whisper couldn't tell).
            language: z.string(),
            segmentCount: z.number().int(),
            // A Russian translation is stored for search and «Техники».
            translatedRu: z.boolean(),
            updatedAt: z.iso.datetime(),
        })
        .nullable(),
    // Chapters: manual vs made by the worker (ocr/speech); subtitles likewise.
    chapters: SourceCountsSchema,
    subtitles: SourceCountsSchema,
    // A «Пересоздать» that is queued or running.
    regeneration: z.enum(['waiting', 'active']).nullable(),
})

export class GetVideoTextStatusFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
    ) {}
}

export type GetVideoTextStatusFeatureResponse = z.infer<typeof GetVideoTextStatusFeatureOutputSchema>

export const RegenerateVideoTextFeatureInputSchema = z
    .object({
        chapters: z.boolean(),
        subtitles: z.boolean(),
    })
    .refine((v) => v.chapters || v.subtitles, {
        message: 'Выберите главы или субтитры',
    })

export const RegenerateVideoTextFeatureOutputSchema = z.object({
    status: z.literal('queued'),
    // Automatic rows removed before the worker makes them again.
    chaptersRemoved: z.number().int(),
    subtitlesRemoved: z.number().int(),
})

export class RegenerateVideoTextFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
        readonly payload: z.infer<typeof RegenerateVideoTextFeatureInputSchema>,
        readonly invokerUserId: string,
    ) {}
}

export type RegenerateVideoTextFeatureResponse = z.infer<typeof RegenerateVideoTextFeatureOutputSchema>

export const SUBTITLE_PREVIEW_CUES = 300

export const GetSubtitleCuesFeatureOutputSchema = z.object({
    // The first SUBTITLE_PREVIEW_CUES cues, seconds from the start.
    cues: z.array(z.object({ from: z.number(), to: z.number(), text: z.string() })),
    total: z.number().int(),
})

export class GetSubtitleCuesFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
        readonly subtitleId: string,
    ) {}
}

export type GetSubtitleCuesFeatureResponse = z.infer<typeof GetSubtitleCuesFeatureOutputSchema>
