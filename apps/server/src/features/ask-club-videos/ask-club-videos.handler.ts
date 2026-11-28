import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { monthlyAiAllowance } from '../../domains/ai-assistant/ai-allowance'
import {
    isLlmConfigured,
    LlmChatClient,
    LlmChatError,
    type LlmMessage,
    type LlmUsage,
} from '../../domains/ai-assistant/llm-chat.client'
import { VIDEO_ANSWERS_NOTICE } from '../../domains/ai-assistant/video-answers-notice'
import { AuditService } from '../../domains/audit/services/audit.service'
import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { visibleVideoCourseSelect } from '../../domains/playlist/services/video-course-pick'
import { PrismaService } from '../../infrastructure/prisma'
import {
    AiServiceUnavailableError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    ModuleNotEntitledError,
    NotFoundError,
    QuotaExceededError,
} from '../../shared/errors/shared.errors'
import { pseudonymizeQuestion } from '../ai-chat/ai-chat-utils'
import { loadKnownPeople } from '../ai-chat/known-people'
import { localDateInTz, wallClockToUtc } from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import {
    AcceptClubVideoAnswersNoticeFeature,
    AcceptClubVideoAnswersNoticeFeatureResponse,
    AskClubVideosFeature,
    AskClubVideosFeatureResponse,
    GetClubVideoAnswersStateFeature,
    GetClubVideoAnswersStateFeatureResponse,
} from './ask-club-videos.feature'
import { askClubVideosMomentsSql } from './ask-club-videos.sql'
import {
    ANSWER_MAX_TOKENS,
    ANSWER_TIMEOUT_MS,
    buildAnswerMessages,
    buildExcerpt,
    buildExpansionMessages,
    buildSearchTerms,
    DAILY_QUESTIONS_PER_MEMBER,
    EXPANSION_MAX_TOKENS,
    excerptCues,
    type MomentHitRow,
    NO_ANSWER_TEXT,
    parseAnswer,
    parseExpansionTerms,
    pickMoments,
    termPatterns,
} from './ask-club-videos-utils'

export const VIDEO_ANSWERS_NOT_CONFIGURED_MESSAGE = 'ИИ-ответы по видео сейчас недоступны'
export const VIDEO_ANSWERS_DISABLED_MESSAGE = 'Клуб не включил ИИ-ответы по видео'
export const VIDEO_ANSWERS_NOTICE_MESSAGE =
    'Сначала подтвердите, что вопрос можно отправить ИИ-сервису'
export const VIDEO_ANSWERS_CHILD_MESSAGE = 'В профиле ребёнка ИИ-ответы по видео недоступны'
const TIMEOUT_MESSAGE = 'ИИ не ответил за 30 секунд — попробуйте ещё раз'
const FAILED_MESSAGE = 'ИИ сейчас не отвечает — попробуйте позже'

const USAGE_KIND = 'videoAnswer'

const loadClub = async (prisma: PrismaService, workspaceId: string) => {
    const club = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { type: true, timezone: true, ownerId: true, videoAnswersEnabled: true },
    })
    if (!club) throw new NotFoundError({ message: 'Клуб не найден' })
    return club
}

// The club's videos open to this user (CourseAccessService's membership and
// video gate); null when they aren't — with the reason, for a single request.
const videoAccess = async (
    courseAccess: CourseAccessService,
    workspaceId: string,
    userId: string,
): Promise<{ isStaff: boolean } | { refused: ForbiddenError | ModuleNotEntitledError }> => {
    try {
        return await courseAccess.resolveMemberAccess(workspaceId, userId)
    } catch (e) {
        if (e instanceof ForbiddenError || e instanceof ModuleNotEntitledError) return { refused: e }
        throw e
    }
}

const noticeAccepted = async (
    prisma: PrismaService,
    workspaceId: string,
    userId: string,
): Promise<boolean> =>
    (await prisma.aiDataTransferAcceptance.findFirst({
        where: { workspaceId, userId, warningVersion: VIDEO_ANSWERS_NOTICE.version },
        select: { id: true },
    })) !== null

const readState = async (
    prisma: PrismaService,
    courseAccess: CourseAccessService,
    workspaceId: string,
    userId: string,
): Promise<GetClubVideoAnswersStateFeatureResponse> => {
    const club = await loadClub(prisma, workspaceId)
    const available =
        isLlmConfigured() &&
        club.videoAnswersEnabled &&
        !('refused' in (await videoAccess(courseAccess, workspaceId, userId)))
    return {
        available,
        noticeAccepted: available && (await noticeAccepted(prisma, workspaceId, userId)),
        notice: { ...VIDEO_ANSWERS_NOTICE },
    }
}

/**
 * Whether «Спросить ИИ по видео клуба» shows in the app: the AI model is
 * configured, the club switched it on and its videos are open to this user —
 * never in a child profile. Never refuses a member (the app reads it on
 * opening the search).
 */
@Feature(GetClubVideoAnswersStateFeature)
export class GetClubVideoAnswersStateHandler
    implements IFeatureHandler<GetClubVideoAnswersStateFeature, GetClubVideoAnswersStateFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute({ workspaceId, userId, actingForChild }: GetClubVideoAnswersStateFeature) {
        // Not offered in a child profile (a guardian acting for a child).
        if (actingForChild) return { available: false, noticeAccepted: false, notice: { ...VIDEO_ANSWERS_NOTICE } }
        return readState(this.prisma, this.courseAccess, workspaceId, userId)
    }
}

/** The member agrees, once per club and edition, that a question goes to the AI service. */
@Feature(AcceptClubVideoAnswersNoticeFeature)
export class AcceptClubVideoAnswersNoticeHandler
    implements
        IFeatureHandler<AcceptClubVideoAnswersNoticeFeature, AcceptClubVideoAnswersNoticeFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
        private readonly audit: AuditService,
    ) {}

    async execute({ workspaceId, userId, payload, ip, userAgent, actingForChild }: AcceptClubVideoAnswersNoticeFeature) {
        if (actingForChild) throw new ForbiddenError({ message: VIDEO_ANSWERS_CHILD_MESSAGE })
        const state = await readState(this.prisma, this.courseAccess, workspaceId, userId)
        if (!state.available) throw new ForbiddenError({ message: VIDEO_ANSWERS_DISABLED_MESSAGE })
        if (payload.version !== VIDEO_ANSWERS_NOTICE.version) {
            throw new ConflictError({
                message: 'Текст предупреждения обновился — откройте его заново.',
            })
        }
        // A double tap: already accepted.
        if (state.noticeAccepted) return state
        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { firstname: true, lastname: true, email: true },
        })
        await this.prisma.aiDataTransferAcceptance.create({
            data: {
                workspaceId,
                userId,
                userEmail: user.email,
                userName: displayName(user).slice(0, 255),
                warningVersion: VIDEO_ANSWERS_NOTICE.version,
                ip: ip?.slice(0, 64) ?? null,
                userAgent: userAgent?.slice(0, 512) ?? null,
            },
        })
        await this.audit.record({
            action: 'ai.videoAnswerNotice',
            targetType: 'aiChat',
            targetId: null,
            workspaceId,
            actorId: userId,
            actorEmail: user.email,
            metadata: { warningVersion: VIDEO_ANSWERS_NOTICE.version },
        })
        return { ...state, noticeAccepted: true }
    }
}

/**
 * «Спросить ИИ по видео клуба»: a short answer built only from the club's own
 * transcripts of the videos this member may watch, citing the moments.
 * The model gets the question (phone, e-mail and club members' full names
 * scrubbed) and transcript excerpts — nothing about the member. Two model
 * calls: search terms, then the answer from the excerpts found with them.
 */
@Feature(AskClubVideosFeature)
export class AskClubVideosHandler
    implements IFeatureHandler<AskClubVideosFeature, AskClubVideosFeatureResponse>
{
    private readonly logger = new Logger(AskClubVideosHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
        private readonly llm: LlmChatClient,
        private readonly audit: AuditService,
    ) {}

    async execute({
        workspaceId,
        userId,
        payload,
        actingForChild,
    }: AskClubVideosFeature): Promise<AskClubVideosFeatureResponse> {
        if (actingForChild) throw new ForbiddenError({ message: VIDEO_ANSWERS_CHILD_MESSAGE })
        if (!isLlmConfigured()) throw new BadRequestError({ message: VIDEO_ANSWERS_NOT_CONFIGURED_MESSAGE })
        const club = await loadClub(this.prisma, workspaceId)
        if (!club.videoAnswersEnabled) throw new ForbiddenError({ message: VIDEO_ANSWERS_DISABLED_MESSAGE })
        const access = await videoAccess(this.courseAccess, workspaceId, userId)
        if ('refused' in access) throw access.refused
        if (!(await noticeAccepted(this.prisma, workspaceId, userId))) {
            throw new ForbiddenError({ message: VIDEO_ANSWERS_NOTICE_MESSAGE })
        }

        const ready = await this.prisma.video.findMany({
            where: { workspaceId, status: 'ready' },
            select: { id: true },
        })
        const watchable = await this.courseAccess.watchableVideoIds(
            workspaceId,
            userId,
            ready.map((v) => v.id),
        )
        // Nothing to answer from: no model call, nothing counted.
        if (watchable.size === 0) return { answer: NO_ANSWER_TEXT, answered: false, citations: [] }

        // Only the question leaves: phone and e-mail hidden, full names of
        // the club's people replaced by pseudonyms (like the admin's chat).
        const question = pseudonymizeQuestion(
            payload.question,
            await loadKnownPeople(this.prisma, { workspaceId, ownerId: club.ownerId }),
        ).content
        const started = Date.now()
        // Counted before the first call (a failure still counts, like the
        // chat), and checked against both caps in the same transaction under
        // the club's and the member's locks, so parallel questions can't all
        // pass the check before any of them is counted.
        const usageRow = await this.countQuestion(workspaceId, userId, club.timezone)
        const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 }
        const deadline = AbortSignal.timeout(ANSWER_TIMEOUT_MS)
        const trace = { terms: 0, excerpts: 0, cited: 0 }
        let status: 'ok' | 'error' = 'error'
        try {
            const expanded = parseExpansionTerms(
                await this.complete(buildExpansionMessages(question, club.type), EXPANSION_MAX_TOKENS, deadline, usage),
            )
            const terms = buildSearchTerms({ question, expanded, sport: club.type })
            trace.terms = terms.length
            const result = await this.answerFrom(
                { workspaceId, userId, isStaff: access.isStaff, question, terms, watchable },
                deadline,
                usage,
                trace,
            )
            status = 'ok'
            return result
        } finally {
            // Bookkeeping never replaces the answer or the error.
            await this.prisma.aiChatUsage
                .update({ where: { id: usageRow.id }, data: { ...usage, status } })
                .catch((error: unknown) =>
                    this.logger.error(
                        'Ответ по видео: usage update failed',
                        error instanceof Error ? error.stack : String(error),
                    ),
                )
            await this.audit.record({
                action: 'ai.videoAnswerQuestion',
                targetType: 'aiChat',
                targetId: null,
                workspaceId,
                actorId: userId,
                metadata: {
                    // What left the server: the question with contacts hidden.
                    question: question.slice(0, 200),
                    ...trace,
                    answered: trace.cited > 0,
                    model: this.llm.model,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    status,
                    durationMs: Date.now() - started,
                },
            })
        }
    }

    // The club's monthly allowance (shared with the admin's chat) and this
    // member's daily cap, checked and the question counted atomically.
    private countQuestion(workspaceId: string, userId: string, timezone: string) {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-allowance:${workspaceId}`}))`
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`video-answers:${workspaceId}:${userId}`}))`
            const now = new Date()
            const allowance = await monthlyAiAllowance(tx, { workspaceId, timezone }, now)
            if (allowance.remaining <= 0) {
                throw new QuotaExceededError({
                    message: 'ИИ-вопросы клуба на этот месяц закончились — лимит обновится 1-го числа.',
                    metadata: { perMonth: allowance.perMonth },
                })
            }
            const today = await tx.aiChatUsage.count({
                where: {
                    workspaceId,
                    userId,
                    kind: USAGE_KIND,
                    createdAt: { gte: wallClockToUtc(`${localDateInTz(now, timezone)}T00:00:00`, timezone) },
                },
            })
            if (today >= DAILY_QUESTIONS_PER_MEMBER) {
                throw new QuotaExceededError({
                    message: `Сегодня вы уже задали ${DAILY_QUESTIONS_PER_MEMBER} вопросов ИИ — продолжим завтра.`,
                    metadata: { perDay: DAILY_QUESTIONS_PER_MEMBER },
                })
            }
            return tx.aiChatUsage.create({
                data: { workspaceId, userId, kind: USAGE_KIND, model: this.llm.model.slice(0, 128) },
                select: { id: true },
            })
        })
    }

    private async answerFrom(
        p: {
            workspaceId: string
            userId: string
            isStaff: boolean
            question: string
            terms: string[]
            watchable: ReadonlySet<string>
        },
        deadline: AbortSignal,
        usage: LlmUsage,
        trace: { excerpts: number; cited: number },
    ): Promise<AskClubVideosFeatureResponse> {
        const noAnswer = { answer: NO_ANSWER_TEXT, answered: false, citations: [] }
        if (p.terms.length === 0) return noAnswer
        const rows = await this.prisma.$queryRaw<MomentHitRow[]>(
            askClubVideosMomentsSql({
                workspaceId: p.workspaceId,
                videoIds: [...p.watchable],
                patterns: termPatterns(p.terms),
            }),
        )
        const moments = pickMoments(rows, p.watchable)
        if (moments.length === 0) return noAnswer

        const videoIds = [...new Set(moments.map((m) => m.videoId))]
        const transcripts = await this.prisma.videoTranscript.findMany({
            where: { videoId: { in: videoIds } },
            select: { videoId: true, segments: true, translations: true },
        })
        const transcriptOf = new Map(transcripts.map((t) => [t.videoId, t]))
        const excerpts = moments.map((m, i) => buildExcerpt(i + 1, m, excerptCues(transcriptOf.get(m.videoId))))
        trace.excerpts = excerpts.length

        const parsed = parseAnswer(
            await this.complete(buildAnswerMessages(p.question, excerpts), ANSWER_MAX_TOKENS, deadline, usage),
            excerpts.map((e) => e.n),
        )
        if (!parsed) return noAnswer
        trace.cited = parsed.cited.length

        const viewer = await this.courseAccess.loadViewer({
            workspaceId: p.workspaceId,
            userId: p.userId,
            isStaff: p.isStaff,
        })
        const courses = await this.prisma.video.findMany({
            where: { id: { in: videoIds }, workspaceId: p.workspaceId },
            select: { id: true, courses: visibleVideoCourseSelect(viewer) },
        })
        const courseOf = new Map(courses.map((v) => [v.id, v.courses[0]?.course.id ?? null]))
        return {
            answer: parsed.answer,
            answered: true,
            citations: parsed.cited.map((excerptN, i) => {
                const e = excerpts[excerptN - 1]
                return {
                    n: i + 1,
                    videoId: e.videoId,
                    courseId: courseOf.get(e.videoId) ?? null,
                    title: e.title,
                    startAt: e.startAt,
                    endAt: e.endAt,
                    excerpt: e.snippet,
                }
            }),
        }
    }

    // One model call, its text accumulated. Any failure becomes a message a
    // member can read (no provider or configuration details).
    private async complete(
        messages: LlmMessage[],
        maxTokens: number,
        deadline: AbortSignal,
        usage: LlmUsage,
    ): Promise<string> {
        let text = ''
        try {
            for await (const ev of this.llm.stream({ messages, tools: [], maxTokens, signal: deadline })) {
                if (ev.kind === 'text') text += ev.text
                else if (ev.kind === 'usage') {
                    usage.inputTokens += ev.usage.inputTokens
                    usage.outputTokens += ev.usage.outputTokens
                }
            }
        } catch (error) {
            if (deadline.aborted) throw new AiServiceUnavailableError({ message: TIMEOUT_MESSAGE })
            if (!(error instanceof LlmChatError)) {
                this.logger.error('Ответ по видео: model call failed', error instanceof Error ? error.stack : String(error))
            }
            throw new AiServiceUnavailableError({ message: FAILED_MESSAGE })
        }
        return text
    }
}
