jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import { LlmChatError, type LlmStreamEvent } from '../../domains/ai-assistant/llm-chat.client'
import { VIDEO_ANSWERS_NOTICE } from '../../domains/ai-assistant/video-answers-notice'
import { STAFF_VIEWER } from '../../domains/playlist/services/course-audience'
import { environment } from '../../environments/environment'
import {
    AiServiceUnavailableError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    QuotaExceededError,
} from '../../shared/errors/shared.errors'
import {
    AcceptClubVideoAnswersNoticeFeature,
    AskClubVideosFeature,
    GetClubVideoAnswersStateFeature,
} from './ask-club-videos.feature'
import {
    AcceptClubVideoAnswersNoticeHandler,
    AskClubVideosHandler,
    GetClubVideoAnswersStateHandler,
    VIDEO_ANSWERS_CHILD_MESSAGE,
    VIDEO_ANSWERS_DISABLED_MESSAGE,
    VIDEO_ANSWERS_NOTICE_MESSAGE,
} from './ask-club-videos.handler'
import { DAILY_QUESTIONS_PER_MEMBER, type MomentHitRow, NO_ANSWER_TEXT } from './ask-club-videos-utils'

const V1 = '11111111-1111-4111-8111-111111111111'
const V2 = '22222222-2222-4222-8222-222222222222'
const LOCKED = '33333333-3333-4333-8333-333333333333'
const COURSE = '44444444-4444-4444-8444-444444444444'

const row = (over: Partial<MomentHitRow>): MomentHitRow => ({
    videoId: V1,
    title: 'Выходы из маунта',
    kind: 'speech',
    at: 100,
    text: 'выход из маунта',
    score: 1,
    titleScore: 0,
    ...over,
})

const text = (t: string): LlmStreamEvent[] => [
    { kind: 'text', text: t },
    { kind: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
]

type Opts = {
    enabled?: boolean
    accepted?: boolean
    refused?: Error
    monthUsed?: number
    todayUsed?: number
    ready?: string[]
    watchable?: string[]
    rows?: MomentHitRow[]
    script?: LlmStreamEvent[][] | Error
}

const setup = (o: Opts = {}) => {
    const tx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        aiChatUsage: {
            count: jest.fn(async (args: { where: { userId?: string } }) =>
                args.where.userId ? (o.todayUsed ?? 0) : (o.monthUsed ?? 0),
            ),
            create: jest.fn().mockResolvedValue({ id: 'usage1' }),
        },
        workspaceBilling: { findUnique: jest.fn().mockResolvedValue(null) },
    }
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                type: 'GRAPPLING',
                timezone: 'Europe/Moscow',
                ownerId: 'owner',
                videoAnswersEnabled: o.enabled ?? true,
            }),
        },
        aiDataTransferAcceptance: {
            findFirst: jest.fn().mockResolvedValue(o.accepted === false ? null : { id: 'acc1' }),
            create: jest.fn().mockResolvedValue({}),
        },
        aiChatUsage: { update: jest.fn().mockResolvedValue({}) },
        video: {
            findMany: jest.fn(async (args: { where: { id?: { in: string[] } } }) =>
                args.where.id
                    ? args.where.id.in.map((id) => ({
                          id,
                          courses: id === V1 ? [{ course: { id: COURSE, title: 'Основы' } }] : [],
                      }))
                    : (o.ready ?? [V1, V2, LOCKED]).map((id) => ({ id })),
            ),
        },
        $queryRaw: jest.fn().mockResolvedValue(o.rows ?? [row({})]),
        videoTranscript: {
            findMany: jest.fn().mockResolvedValue([
                {
                    videoId: V1,
                    segments: [
                        { from: 95, to: 110, text: 'If they hold the head, push the biceps' },
                    ],
                    translations: {
                        ru: [{ from: 95, to: 110, text: 'Если держат голову, упритесь в бицепс' }],
                    },
                },
            ]),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue({ id: 'owner', firstname: 'Олег', lastname: 'Владельцев' }),
            findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue({ firstname: 'Иван', lastname: 'Петров', email: 'ivan@x.ru' }),
        },
        workspaceMember: {
            findMany: jest.fn().mockResolvedValue([
                { userId: 'ivan', role: { name: 'user' }, user: { firstname: 'Иван', lastname: 'Петров' } },
            ]),
        },
        // Only the transaction counts and inserts usage rows.
        $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    }
    const courseAccess = {
        resolveMemberAccess: o.refused
            ? jest.fn().mockRejectedValue(o.refused)
            : jest.fn().mockResolvedValue({ isStaff: false }),
        watchableVideoIds: jest.fn(
            async (_ws: string, _u: string, ids: readonly string[]) =>
                new Set(ids.filter((id) => (o.watchable ?? [V1, V2]).includes(id))),
        ),
        loadViewer: jest.fn().mockResolvedValue(STAFF_VIEWER),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const requests: { messages: { role: string; content: string }[] }[] = []
    const script = o.script ?? [text('{"terms": ["маунт", "голова"]}'), text('Упритесь в бицепс [1].')]
    let call = 0
    const llm = {
        model: 'test/model',
        stream: jest.fn().mockImplementation(async function* (p: unknown) {
            requests.push(JSON.parse(JSON.stringify(p)))
            if (script instanceof Error) throw script
            for (const e of script[call++] ?? []) yield e
        }),
    }
    return { prisma, tx, courseAccess, audit, llm, requests }
}

const ask = (
    s: ReturnType<typeof setup>,
    question = 'как выйти из маунта, если держат голову?',
    actingForChild = false,
) =>
    new AskClubVideosHandler(s.prisma as never, s.courseAccess as never, s.llm as never, s.audit as never).execute(
        new AskClubVideosFeature('w1', 'u1', { question }, actingForChild),
    )

describe('«Спросить ИИ по видео клуба»', () => {
    const saved = { ...environment.ai.chat }
    beforeEach(() => {
        Object.assign(environment.ai.chat, saved, { apiKey: 'key', monthlyQuestions: 5, trialMonthlyQuestions: 5 })
    })
    afterAll(() => {
        Object.assign(environment.ai.chat, saved)
    })

    describe('GetClubVideoAnswersStateHandler', () => {
        const state = (s: ReturnType<typeof setup>) =>
            new GetClubVideoAnswersStateHandler(s.prisma as never, s.courseAccess as never).execute(
                new GetClubVideoAnswersStateFeature('w1', 'u1', false),
            )

        it('available with the notice when configured, switched on and the videos are open', async () => {
            const res = await state(setup({ accepted: false }))
            expect(res).toEqual({
                available: true,
                noticeAccepted: false,
                notice: { ...VIDEO_ANSWERS_NOTICE },
            })
            expect((await state(setup())).noticeAccepted).toBe(true)
        })

        it('unavailable without the model, without the club switch, or with videos closed to the member', async () => {
            environment.ai.chat.apiKey = ''
            expect((await state(setup())).available).toBe(false)
            environment.ai.chat.apiKey = 'key'
            expect((await state(setup({ enabled: false }))).available).toBe(false)
            const closed = await state(setup({ refused: new ForbiddenError({ message: 'Видео отключены в вашем клубе' }) }))
            expect(closed).toMatchObject({ available: false, noticeAccepted: false })
        })

        it('unavailable in a child profile', async () => {
            const res = await new GetClubVideoAnswersStateHandler(
                setup().prisma as never,
                setup().courseAccess as never,
            ).execute(new GetClubVideoAnswersStateFeature('w1', 'u1', true))
            expect(res).toMatchObject({ available: false, noticeAccepted: false })
        })
    })

    describe('AcceptClubVideoAnswersNoticeHandler', () => {
        const accept = (
            s: ReturnType<typeof setup>,
            version: string = VIDEO_ANSWERS_NOTICE.version,
            actingForChild = false,
        ) =>
            new AcceptClubVideoAnswersNoticeHandler(s.prisma as never, s.courseAccess as never, s.audit as never).execute(
                new AcceptClubVideoAnswersNoticeFeature('w1', 'u1', { version }, '1.2.3.4', 'app', actingForChild),
            )

        it("records the member's acceptance once, with an audit entry", async () => {
            const s = setup({ accepted: false })
            const res = await accept(s)
            expect(res.noticeAccepted).toBe(true)
            expect(s.prisma.aiDataTransferAcceptance.create.mock.calls[0][0].data).toMatchObject({
                workspaceId: 'w1',
                userId: 'u1',
                warningVersion: VIDEO_ANSWERS_NOTICE.version,
                ip: '1.2.3.4',
            })
            expect(s.audit.record.mock.calls[0][0]).toMatchObject({ action: 'ai.videoAnswerNotice', actorId: 'u1' })

            const again = setup()
            await accept(again)
            expect(again.prisma.aiDataTransferAcceptance.create).not.toHaveBeenCalled()
        })

        it('refuses a stale edition and a club without the feature', async () => {
            await expect(accept(setup({ accepted: false }), 'video-answers-old')).rejects.toBeInstanceOf(ConflictError)
            await expect(accept(setup({ enabled: false }))).rejects.toThrow(VIDEO_ANSWERS_DISABLED_MESSAGE)
        })

        it('a child profile cannot accept the notice', async () => {
            const s = setup({ accepted: false })
            await expect(accept(s, VIDEO_ANSWERS_NOTICE.version, true)).rejects.toThrow(VIDEO_ANSWERS_CHILD_MESSAGE)
            expect(s.prisma.aiDataTransferAcceptance.create).not.toHaveBeenCalled()
        })
    })

    describe('AskClubVideosHandler', () => {
        it('expands the question, searches only watchable videos and answers with cited moments', async () => {
            const s = setup()
            const res = await ask(s)
            expect(res).toEqual({
                answer: 'Упритесь в бицепс [1].',
                answered: true,
                citations: [
                    {
                        n: 1,
                        videoId: V1,
                        courseId: COURSE,
                        title: 'Выходы из маунта',
                        startAt: 95,
                        endAt: 110,
                        excerpt: 'выход из маунта',
                    },
                ],
            })
            // Search terms: the model's, then the glossary's English name.
            const sql = s.prisma.$queryRaw.mock.calls[0][0] as { values: unknown[] }
            expect(sql.values).toContainEqual([V1, V2])
            expect(sql.values).not.toContainEqual(expect.arrayContaining([LOCKED]))
            const patterns = sql.values.find(
                (v): v is string[] => Array.isArray(v) && v.some((x) => String(x).startsWith('%')),
            )
            expect(patterns).toEqual(expect.arrayContaining(['%маунт%', '%mount%']))
            // The answer call reads the Russian excerpt around the moment.
            expect(s.requests[1].messages[1].content).toContain('Если держат голову, упритесь в бицепс')
            // Counted in the club's shared allowance as a video answer.
            expect(s.tx.aiChatUsage.create.mock.calls[0][0].data).toMatchObject({ kind: 'videoAnswer', userId: 'u1' })
            expect(s.prisma.aiChatUsage.update.mock.calls[0][0].data).toEqual({
                inputTokens: 20,
                outputTokens: 10,
                status: 'ok',
            })
            expect(s.audit.record.mock.calls[0][0]).toMatchObject({
                action: 'ai.videoAnswerQuestion',
                metadata: { status: 'ok', answered: true, excerpts: 1, cited: 1 },
            })
        })

        it('never cites a video the member may not watch, even if the query returned it', async () => {
            const s = setup({
                rows: [row({ videoId: LOCKED, score: 9, title: 'Закрытый урок' }), row({ videoId: V1 })],
                script: [text('{"terms": ["маунт"]}'), text('Ответ [1][2].')],
            })
            const res = await ask(s)
            expect(res.citations.map((c) => c.videoId)).toEqual([V1])
            expect(s.requests[1].messages[1].content).not.toContain('Закрытый урок')
        })

        it('sends only the question, with phone and e-mail hidden', async () => {
            const s = setup()
            await ask(s, 'маунт: позвоните +7 913 555-12-34 или a@b.ru')
            const sent = JSON.stringify(s.requests)
            expect(sent).not.toContain('555-12-34')
            expect(sent).not.toContain('a@b.ru')
            expect(sent).toContain('[телефон скрыт]')
            expect(s.audit.record.mock.calls[0][0].metadata.question).not.toContain('a@b.ru')
        })

        it('honestly says the videos do not cover it: no moments found, or the model found no answer', async () => {
            const none = setup({ rows: [] })
            expect(await ask(none)).toEqual({ answer: NO_ANSWER_TEXT, answered: false, citations: [] })
            expect(none.llm.stream).toHaveBeenCalledTimes(1)

            const noAnswer = setup({ script: [text('{"terms": ["маунт"]}'), text('NO_ANSWER')] })
            expect(await ask(noAnswer)).toMatchObject({ answered: false, citations: [] })

            const uncited = setup({ script: [text('{"terms": ["маунт"]}'), text('Просто делайте мост.')] })
            expect(await ask(uncited)).toMatchObject({ answer: NO_ANSWER_TEXT, answered: false })
        })

        it('falls back to the words of the question when the expansion is not JSON', async () => {
            const s = setup({ script: [text('не знаю'), text('Ответ [1].')] })
            await ask(s)
            const sql = s.prisma.$queryRaw.mock.calls[0][0] as { values: unknown[] }
            expect(JSON.stringify(sql.values)).toContain('%маунт%')
        })

        it('no videos to answer from: no model call, nothing counted', async () => {
            const s = setup({ watchable: [] })
            expect(await ask(s)).toMatchObject({ answered: false })
            expect(s.llm.stream).not.toHaveBeenCalled()
            expect(s.tx.aiChatUsage.create).not.toHaveBeenCalled()
        })

        it('refuses before any model call: not configured, club switch off, videos closed, no notice', async () => {
            environment.ai.chat.apiKey = ''
            await expect(ask(setup())).rejects.toBeInstanceOf(BadRequestError)
            environment.ai.chat.apiKey = 'key'
            await expect(ask(setup({ enabled: false }))).rejects.toThrow(VIDEO_ANSWERS_DISABLED_MESSAGE)
            await expect(
                ask(setup({ refused: new ForbiddenError({ message: 'Участник неактивен' }) })),
            ).rejects.toThrow('Участник неактивен')
            const noNotice = setup({ accepted: false })
            await expect(ask(noNotice)).rejects.toThrow(VIDEO_ANSWERS_NOTICE_MESSAGE)
            expect(noNotice.llm.stream).not.toHaveBeenCalled()
        })

        it("refuses when the club's monthly allowance or the member's daily cap is used up", async () => {
            const month = setup({ monthUsed: 5 })
            await expect(ask(month)).rejects.toBeInstanceOf(QuotaExceededError)
            expect(month.llm.stream).not.toHaveBeenCalled()

            const day = setup({ todayUsed: DAILY_QUESTIONS_PER_MEMBER })
            await expect(ask(day)).rejects.toThrow(`уже задали ${DAILY_QUESTIONS_PER_MEMBER} вопросов`)
            expect(day.tx.aiChatUsage.count.mock.calls[1][0].where).toMatchObject({
                workspaceId: 'w1',
                userId: 'u1',
                kind: 'videoAnswer',
            })
        })

        it('a failing model: a readable error, the question still counted and audited', async () => {
            const s = setup({ script: new LlmChatError('ИИ-сервис ответил ошибкой 401: проверьте AI_CHAT_API_KEY', 401) })
            const failure = ask(s)
            await expect(failure).rejects.toBeInstanceOf(AiServiceUnavailableError)
            await expect(failure).rejects.not.toThrow('AI_CHAT_API_KEY')
            expect(s.prisma.aiChatUsage.update.mock.calls[0][0].data.status).toBe('error')
            expect(s.audit.record.mock.calls[0][0].metadata.status).toBe('error')
        })

        it('a failed usage update never replaces the answer, and the question is still audited', async () => {
            const s = setup()
            s.prisma.aiChatUsage.update.mockRejectedValue(new Error('db down'))
            expect(await ask(s)).toMatchObject({ answered: true })
            expect(s.audit.record).toHaveBeenCalledTimes(1)
        })

        it('checks both caps and counts the question in one transaction, under the club and member locks', async () => {
            const s = setup()
            await ask(s)
            expect(s.prisma.$transaction).toHaveBeenCalledTimes(1)
            const locks = s.tx.$executeRaw.mock.calls.map((c) => (c as unknown[]).slice(1))
            expect(locks).toEqual([['ai-allowance:w1'], ['video-answers:w1:u1']])
            // Locks first, then the monthly and the daily count, then the insert — all on the transaction.
            const order = [
                ...s.tx.$executeRaw.mock.invocationCallOrder,
                ...s.tx.aiChatUsage.count.mock.invocationCallOrder,
                s.tx.aiChatUsage.create.mock.invocationCallOrder[0],
            ]
            expect(order).toEqual([...order].sort((a, b) => a - b))
            expect(s.tx.aiChatUsage.count).toHaveBeenCalledTimes(2)
        })

        it('replaces the full names of club people in the question with pseudonyms', async () => {
            const s = setup()
            await ask(s, 'как Иван Петров выходит из маунта?')
            const sent = JSON.stringify(s.requests)
            expect(sent).not.toContain('Петров')
            expect(sent).toMatch(/m_[0-9a-f]{10}/)
        })

        it('a child profile (guardian acting for a child) is refused before anything else', async () => {
            const s = setup()
            await expect(ask(s, undefined, true)).rejects.toThrow(VIDEO_ANSWERS_CHILD_MESSAGE)
            expect(s.prisma.workspace.findUnique).not.toHaveBeenCalled()
            expect(s.llm.stream).not.toHaveBeenCalled()
        })
    })
})
