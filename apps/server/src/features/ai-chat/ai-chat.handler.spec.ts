import { AI_CHAT_DATA_WARNING } from '../../domains/ai-assistant/ai-chat-warning'
import { LlmChatError, type LlmStreamEvent } from '../../domains/ai-assistant/llm-chat.client'
import { pseudonymFor } from '../../domains/ai-assistant/pseudonym'
import { environment } from '../../environments/environment'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    QuotaExceededError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AcceptAiChatWarningFeature,
    type AiChatStreamEvent,
    AskAiChatFeature,
    DeleteAiChatConversationFeature,
    GetAiChatConversationFeature,
    GetAiChatStateFeature,
    ListAiChatConversationsFeature,
} from './ai-chat.feature'
import {
    AcceptAiChatWarningHandler,
    AskAiChatHandler,
    DeleteAiChatConversationHandler,
    GetAiChatConversationHandler,
    GetAiChatStateHandler,
    ListAiChatConversationsHandler,
} from './ai-chat.handler'
import { AI_CHAT_CONSENT_MESSAGE, AI_CHAT_OWNER_ONLY_MESSAGE, AiChatService } from './ai-chat.service'

type Role = 'owner' | 'admin' | 'manager' | 'coach' | 'user'

const MEMBER_ROLE: Record<Exclude<Role, 'owner'>, string> = {
    admin: 'admin',
    manager: 'coach',
    coach: 'coach',
    user: 'user',
}

const CONV = '7d0c3b52-9f4e-4c1a-8b6d-2e5f0a1b3c4d'
const GROUP = '0b5f2c4e-1a2b-4c3d-8e9f-0123456789ab'
const IVAN = '11111111-1111-4111-8111-111111111111'
const ivanRef = () => pseudonymFor(environment.encryptionKey, 'w1', IVAN, 'member')

type Script = LlmStreamEvent[][] | Error

const setup = (
    invoker: Role,
    opts: {
        consent?: boolean
        used?: number
        conversation?: Record<string, unknown> | null
        script?: Script
    } = {},
) => {
    const conversation =
        opts.conversation === undefined
            ? null
            : opts.conversation && {
                  id: CONV,
                  workspaceId: 'w1',
                  userId: invoker,
                  title: 'Кто ходит?',
                  messages: [],
                  refs: {},
                  createdAt: new Date('2026-11-01T10:00:00Z'),
                  updatedAt: new Date('2026-11-01T10:05:00Z'),
                  ...opts.conversation,
              }
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ name: 'Клуб', timezone: 'Europe/Moscow', ownerId: 'owner', coachSeesAllGroups: true }),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(
                invoker === 'owner'
                    ? null
                    : { status: 'ACTIVE', accessUntil: null, role: { name: MEMBER_ROLE[invoker] } },
            ),
            findMany: jest.fn().mockImplementation(async (q: { select: Record<string, unknown> }) =>
                'role' in q.select
                    ? [
                          { userId: IVAN, role: { name: 'user' }, user: { firstname: 'Иван', lastname: 'Петров' } },
                          { userId: 'coach1', role: { name: 'coach' }, user: { firstname: 'Пётр', lastname: 'Тренеров' } },
                      ]
                    : [{ user: { id: IVAN, firstname: 'Иван', lastname: 'Петров', email: null } }],
            ),
        },
        directionManager: {
            findMany: jest.fn().mockResolvedValue(invoker === 'manager' ? [{ directionId: 'bjj' }] : []),
        },
        aiDataTransferAcceptance: {
            findFirst: jest
                .fn()
                .mockResolvedValue(opts.consent === false ? null : { acceptedAt: new Date('2026-10-30T10:00:00Z') }),
            create: jest.fn().mockResolvedValue({}),
        },
        aiChatUsage: {
            count: jest.fn().mockResolvedValue(opts.used ?? 0),
            create: jest.fn().mockResolvedValue({ id: 'usage1' }),
            update: jest.fn().mockResolvedValue({}),
        },
        workspaceBilling: {
            findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', currentPeriodEnd: new Date('2027-01-01') }),
        },
        aiChatConversation: {
            findUnique: jest.fn().mockResolvedValue(conversation),
            findFirst: jest.fn().mockResolvedValue(conversation),
            findMany: jest.fn().mockResolvedValue(conversation ? [conversation] : []),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: conversation ? 1 : 0 }),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue({ id: 'owner', firstname: 'Олег', lastname: 'Владельцев' }),
            findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue({ firstname: 'Олег', lastname: 'Владельцев', email: 'owner@x.ru' }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        group: { findMany: jest.fn().mockResolvedValue([{ id: GROUP, name: 'БЖЖ взрослые' }]) },
        plan: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const rbac = new RbacService(prisma as never)
    const requests: unknown[] = []
    const script = opts.script ?? [[{ kind: 'text', text: 'Всё хорошо' }]]
    let round = 0
    const llm = {
        model: 'test/model',
        stream: jest.fn().mockImplementation(async function* (p: unknown) {
            requests.push(JSON.parse(JSON.stringify(p)))
            if (script instanceof Error) throw script
            for (const e of script[round++] ?? []) yield e
        }),
    }
    const chat = new AiChatService(prisma as never, audit as never, llm as never, {} as never, {} as never)
    return { prisma, audit, rbac, chat, llm, requests }
}

describe('«ИИ-ассистент» chat handlers', () => {
    const saved = { ...environment.ai.chat }
    beforeEach(() => {
        Object.assign(environment.ai.chat, saved, { apiKey: 'key', monthlyQuestions: 5, trialMonthlyQuestions: 2 })
    })
    afterAll(() => {
        Object.assign(environment.ai.chat, saved)
    })

    describe('GetAiChatStateHandler', () => {
        const state = (invoker: Role, opts: Parameters<typeof setup>[1] = {}) => {
            const s = setup(invoker, opts)
            const handler = new GetAiChatStateHandler(s.prisma as never, s.rbac, s.chat)
            return { ...s, run: () => handler.execute(new GetAiChatStateFeature('w1', invoker)) }
        }

        it('tells an admin the chat is ready, the model, the limit and the suggestions', async () => {
            const res = await state('admin', { used: 3 }).run()
            expect(res).toMatchObject({
                configured: true,
                model: 'test/model',
                scope: 'club',
                consent: { accepted: true, canAccept: false, warning: { version: AI_CHAT_DATA_WARNING.version } },
                limit: { perMonth: 5, used: 3, remaining: 2 },
            })
            expect(res.suggestions).toContain('Кому позвонить сегодня?')
        })

        it('a direction manager reads their directions; the owner may turn it on; the trial gets the smaller limit', async () => {
            expect((await state('manager').run()).scope).toBe('directions')
            const s = state('owner', { consent: false })
            s.prisma.workspaceBilling.findUnique.mockResolvedValue({ status: 'TRIAL', currentPeriodEnd: null })
            const res = await s.run()
            expect(res.consent).toMatchObject({ accepted: false, acceptedAt: null, canAccept: true })
            expect(res.limit.perMonth).toBe(environment.billing.enabled ? 2 : 5)
        })

        it('says «не настроено» without a key', async () => {
            environment.ai.chat.apiKey = undefined
            expect(await state('admin').run()).toMatchObject({ configured: false, model: null })
        })

        it.each<Role>(['coach', 'user'])('refuses a %s', async (role) => {
            await expect(state(role).run()).rejects.toBeInstanceOf(ForbiddenError)
        })
    })

    describe('AcceptAiChatWarningHandler', () => {
        const accept = (invoker: Role, version: string = AI_CHAT_DATA_WARNING.version, consent = false) => {
            const s = setup(invoker, { consent })
            const handler = new AcceptAiChatWarningHandler(s.prisma as never, s.rbac, s.chat)
            return {
                ...s,
                run: () =>
                    handler.execute(
                        new AcceptAiChatWarningFeature({ warningVersion: version }, 'w1', invoker, '1.2.3.4', 'UA'),
                    ),
            }
        }

        it('records the owner’s acceptance as evidence and in the audit', async () => {
            const s = accept('owner')
            await s.run()
            expect(s.prisma.aiDataTransferAcceptance.create.mock.calls[0][0].data).toMatchObject({
                workspaceId: 'w1',
                userId: 'owner',
                userEmail: 'owner@x.ru',
                userName: 'Олег Владельцев',
                warningVersion: AI_CHAT_DATA_WARNING.version,
                ip: '1.2.3.4',
                userAgent: 'UA',
            })
            expect(s.audit.record.mock.calls[0][0]).toMatchObject({ action: 'ai.chatEnable', actorId: 'owner' })
        })

        it('a second tap records nothing', async () => {
            const s = accept('owner', AI_CHAT_DATA_WARNING.version, true)
            await s.run()
            expect(s.prisma.aiDataTransferAcceptance.create).not.toHaveBeenCalled()
        })

        it('refuses anyone but the owner, and an old edition', async () => {
            await expect(accept('admin').run()).rejects.toThrow(AI_CHAT_OWNER_ONLY_MESSAGE)
            await expect(accept('owner', 'chat-1999').run()).rejects.toBeInstanceOf(ConflictError)
            await expect(accept('coach').run()).rejects.toBeInstanceOf(ForbiddenError)
        })
    })

    describe('conversations', () => {
        it('lists only the asker’s own conversations', async () => {
            const s = setup('manager', {
                conversation: { messages: [{ role: 'user', content: 'a', text: 'a', at: 'x' }] },
            })
            const res = await new ListAiChatConversationsHandler(s.prisma as never, s.rbac).execute(
                new ListAiChatConversationsFeature('w1', 'manager'),
            )
            expect(s.prisma.aiChatConversation.findMany.mock.calls[0][0].where).toEqual({
                workspaceId: 'w1',
                userId: 'manager',
            })
            expect(res.data).toEqual([expect.objectContaining({ id: CONV, questions: 1 })])
        })

        it('opens one with its turns and chips resolved in scope', async () => {
            const s = setup('admin', {
                conversation: {
                    messages: [
                        { role: 'user', content: 'Кто?', text: 'Кто?', at: '2026-11-01T10:00:00.000Z' },
                        { role: 'assistant', content: `${ivanRef()} в [group:${GROUP}], c_0000000000` },
                    ],
                    refs: { [ivanRef()]: { kind: 'member', userId: IVAN } },
                },
            })
            const res = await new GetAiChatConversationHandler(s.prisma as never, s.rbac, s.chat).execute(
                new GetAiChatConversationFeature('w1', CONV, 'admin'),
            )
            expect(res.turns).toHaveLength(1)
            expect(res.entities).toEqual([
                { token: ivanRef(), type: 'member', id: IVAN, label: 'Иван Петров' },
                { token: `[group:${GROUP}]`, type: 'group', id: GROUP, label: 'БЖЖ взрослые' },
            ])
            expect(s.prisma.aiChatConversation.findFirst.mock.calls[0][0].where).toEqual({
                id: CONV,
                workspaceId: 'w1',
                userId: 'admin',
            })
        })

        it('another staff member’s or a missing conversation is a 404', async () => {
            const s = setup('admin', { conversation: null })
            await expect(
                new GetAiChatConversationHandler(s.prisma as never, s.rbac, s.chat).execute(
                    new GetAiChatConversationFeature('w1', CONV, 'admin'),
                ),
            ).rejects.toBeInstanceOf(NotFoundError)
            await expect(
                new DeleteAiChatConversationHandler(s.prisma as never, s.rbac).execute(
                    new DeleteAiChatConversationFeature('w1', CONV, 'admin'),
                ),
            ).rejects.toBeInstanceOf(NotFoundError)
        })

        it('deletes the asker’s own', async () => {
            const s = setup('admin', { conversation: {} })
            await expect(
                new DeleteAiChatConversationHandler(s.prisma as never, s.rbac).execute(
                    new DeleteAiChatConversationFeature('w1', CONV, 'admin'),
                ),
            ).resolves.toEqual({ id: CONV })
        })
    })

    describe('AskAiChatHandler', () => {
        const ask = (invoker: Role, question: string, opts: Parameters<typeof setup>[1] = {}) => {
            const s = setup(invoker, opts)
            const handler = new AskAiChatHandler(s.prisma as never, s.rbac, s.chat)
            const events: AiChatStreamEvent[] = []
            const prepare = () => handler.execute(new AskAiChatFeature({ question }, 'w1', CONV, invoker))
            const stream = async (signal = new AbortController().signal) => {
                const turn = await prepare()
                await turn.run((e) => events.push(e), signal)
                return events
            }
            return { ...s, prepare, stream, events }
        }

        it('refuses before streaming: not configured, no consent, over the limit, a foreign conversation, too long', async () => {
            environment.ai.chat.apiKey = undefined
            await expect(ask('admin', 'Привет').prepare()).rejects.toBeInstanceOf(BadRequestError)
            environment.ai.chat.apiKey = 'key'
            await expect(ask('admin', 'Привет', { consent: false }).prepare()).rejects.toThrow(AI_CHAT_CONSENT_MESSAGE)
            await expect(ask('admin', 'Привет', { used: 5 }).prepare()).rejects.toBeInstanceOf(QuotaExceededError)
            await expect(
                ask('admin', 'Привет', { conversation: { userId: 'someone-else' } }).prepare(),
            ).rejects.toBeInstanceOf(NotFoundError)
            const long = Array.from({ length: 30 }, () => ({ role: 'user', content: 'a', text: 'a', at: 'x' }))
            await expect(ask('admin', 'Привет', { conversation: { messages: long } }).prepare()).rejects.toThrow(
                'начните новый',
            )
            await expect(ask('coach', 'Привет').prepare()).rejects.toBeInstanceOf(ForbiddenError)
        })

        it('streams a turn: a tool round with refusals the model can read, the answer, chips, usage and audit', async () => {
            const s = ask('admin', 'Как дела у Иван Петров, тел. +7 900 111 22 33?', {
                script: [
                    [
                        { kind: 'text', text: 'Смотрю.' },
                        {
                            kind: 'toolCalls',
                            calls: [
                                { id: 'a', type: 'function', function: { name: 'member_profile', arguments: '{}' } },
                                { id: 'b', type: 'function', function: { name: 'nope', arguments: '{}' } },
                                { id: 'c', type: 'function', function: { name: 'club_overview', arguments: '[1]' } },
                                { id: 'd', type: 'function', function: { name: 'club_overview', arguments: '{oops' } },
                            ],
                        },
                        { kind: 'usage', usage: { inputTokens: 100, outputTokens: 10 } },
                    ],
                    [
                        { kind: 'text', text: `Это ${ivanRef()} из [group:${GROUP}].` },
                        { kind: 'usage', usage: { inputTokens: 200, outputTokens: 20 } },
                    ],
                ],
            })
            const events = await s.stream()
            expect(events.map((e) => e.event)).toEqual([
                'start',
                'text',
                ...Array(8).fill('tool'),
                'text',
                'entities',
                'done',
            ])
            const statuses = events.flatMap((e) => (e.event === 'tool' ? [e.data.status] : []))
            expect(statuses.filter((x) => x === 'error')).toHaveLength(4)
            expect(events.find((e) => e.event === 'entities')).toEqual({
                event: 'entities',
                data: {
                    entities: [
                        { token: ivanRef(), type: 'member', id: IVAN, label: 'Иван Петров' },
                        { token: `[group:${GROUP}]`, type: 'group', id: GROUP, label: 'БЖЖ взрослые' },
                    ],
                },
            })
            expect(events[events.length - 1]).toEqual({
                event: 'done',
                data: { usage: { inputTokens: 300, outputTokens: 30 }, limit: { perMonth: 5, used: 1, remaining: 4 } },
            })

            // The model never saw the name or the phone; the second round got the tool answers.
            const sent = JSON.stringify(s.requests)
            expect(sent).not.toContain('Петров')
            expect(sent).not.toContain('111 22 33')
            expect(sent).toContain(ivanRef())
            expect(sent).toContain('Неизвестный инструмент: nope')
            expect(sent).toContain('Аргументы должны быть JSON-объектом')
            expect(sent).toContain('Некорректные аргументы')

            // Saved and counted.
            expect(s.prisma.aiChatConversation.create.mock.calls[0][0].data).toMatchObject({
                id: CONV,
                userId: 'admin',
                title: 'Как дела у Иван Петров, тел. +7 900 111 22 33?',
                refs: { [ivanRef()]: { kind: 'member', userId: IVAN } },
            })
            const savedMessages = s.prisma.aiChatConversation.update.mock.calls[0][0].data.messages
            expect(savedMessages.map((m: { role: string }) => m.role)).toEqual([
                'user',
                'assistant',
                'tool',
                'tool',
                'tool',
                'tool',
                'assistant',
            ])
            expect(s.prisma.aiChatUsage.update.mock.calls[0][0].data).toEqual({
                inputTokens: 300,
                outputTokens: 30,
                toolCalls: 4,
                status: 'ok',
            })
            const audit = s.audit.record.mock.calls[0][0]
            expect(audit).toMatchObject({ action: 'ai.chatQuestion', targetType: 'aiChat', targetId: CONV })
            expect(audit.metadata).toMatchObject({ toolErrors: 4, status: 'ok', model: 'test/model' })
            expect(audit.metadata.question).toContain(ivanRef())
            expect(audit.metadata.question).not.toContain('Петров')
        })

        it('the last round must answer: tools stay declared but are off', async () => {
            const call = {
                kind: 'toolCalls' as const,
                calls: [{ id: 'x', type: 'function' as const, function: { name: 'nope', arguments: '' } }],
            }
            const s = ask('admin', 'Q', { script: Array.from({ length: 6 }, () => [call]) })
            await s.stream()
            expect(s.llm.stream).toHaveBeenCalledTimes(6)
            expect(s.llm.stream.mock.calls[5][0].toolChoice).toBe('none')
            expect(s.llm.stream.mock.calls[0][0].toolChoice).toBe('auto')
        })

        it('a provider error is shown and saved; a stop is saved quietly', async () => {
            const failed = ask('admin', 'Q', { script: new LlmChatError('ИИ-сервис ответил ошибкой 401: проверьте AI_CHAT_API_KEY') })
            const events = await failed.stream()
            expect(events[events.length - 1]).toEqual({
                event: 'error',
                data: { message: 'ИИ-сервис ответил ошибкой 401: проверьте AI_CHAT_API_KEY' },
            })
            expect(failed.prisma.aiChatUsage.update.mock.calls[0][0].data.status).toBe('error')

            const crashed = ask('admin', 'Q', { script: new Error('boom') })
            expect((await crashed.stream()).pop()).toEqual({
                event: 'error',
                data: { message: 'Не удалось получить ответ — попробуйте ещё раз' },
            })

            const stopped = ask('admin', 'Q', { conversation: { title: 'Старый' }, script: new Error('aborted') })
            const controller = new AbortController()
            controller.abort()
            const stopEvents = await stopped.stream(controller.signal)
            expect(stopEvents.map((e) => e.event)).toEqual(['start'])
            expect(stopped.prisma.aiChatConversation.create).not.toHaveBeenCalled()
            const savedMessages = stopped.prisma.aiChatConversation.update.mock.calls[0][0].data.messages
            expect(savedMessages[savedMessages.length - 1]).toEqual({
                role: 'assistant',
                content: '',
                error: 'Ответ остановлен',
            })
            expect(stopped.prisma.aiChatUsage.update.mock.calls[0][0].data.status).toBe('aborted')
        })
    })
})
