import { z } from 'zod'

import { MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH } from './ask-club-videos-utils'

// «Спросить ИИ по видео клуба» (docs/design/2026-11-28-ask-club-videos.md).

export const ClubVideoAnswersStateOutputSchema = z.object({
    // The AI model is configured, the club switched the answers on and its
    // videos are open to this member. False = the app shows nothing of it.
    available: z.boolean(),
    // This member accepted the current notice in this club.
    noticeAccepted: z.boolean(),
    notice: z.object({
        version: z.string(),
        title: z.string(),
        text: z.string(),
    }),
})

export class GetClubVideoAnswersStateFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly actingForChild: boolean,
    ) {}
}

export type GetClubVideoAnswersStateFeatureResponse = z.infer<
    typeof ClubVideoAnswersStateOutputSchema
>

export const AcceptClubVideoAnswersNoticeInputSchema = z.object({
    // The edition the member read; a stale one is refused.
    version: z.string().min(1).max(64),
})

export class AcceptClubVideoAnswersNoticeFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly payload: z.infer<typeof AcceptClubVideoAnswersNoticeInputSchema>,
        readonly ip: string | null,
        readonly userAgent: string | null,
        readonly actingForChild: boolean,
    ) {}
}

export type AcceptClubVideoAnswersNoticeFeatureResponse = z.infer<
    typeof ClubVideoAnswersStateOutputSchema
>

export const AskClubVideosInputSchema = z.object({
    question: z.string().trim().min(MIN_QUESTION_LENGTH).max(MAX_QUESTION_LENGTH),
})

export const AskClubVideosOutputSchema = z.object({
    // The answer with its citations as [1], [2] … (numbers of `citations`);
    // when `answered` is false, the honest «не нашлось» text and no citations.
    answer: z.string(),
    answered: z.boolean(),
    citations: z.array(
        z.object({
            n: z.number().int(),
            videoId: z.string().uuid(),
            // The course the member sees the video in; null = none to name.
            courseId: z.string().uuid().nullable(),
            title: z.string(),
            startAt: z.number().int(),
            endAt: z.number().int().nullable(),
            // What is said (or the chapter title) at the moment.
            excerpt: z.string(),
        }),
    ),
})

export class AskClubVideosFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly payload: z.infer<typeof AskClubVideosInputSchema>,
        // A guardian acting for a child (X-Act-As): the feature isn't offered there.
        readonly actingForChild: boolean,
    ) {}
}

export type AskClubVideosFeatureResponse = z.infer<typeof AskClubVideosOutputSchema>
