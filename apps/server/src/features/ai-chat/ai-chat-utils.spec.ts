import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import { MCP_READ_TOOLS } from '../mcp/tools'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import {
    buildModelMessages,
    buildSystemPrompt,
    conversationTitle,
    deriveTurns,
    extractEntityTokens,
    joinAnswer,
    monthBounds,
    OLD_TOOL_RESULT_CHARS,
    parseStoredMessages,
    parseStoredRefs,
    pseudonymizeQuestion,
    type StoredChatMessage,
    toolLabel,
    toolLabelKeys,
} from './ai-chat-utils'

const access = (directionIds: string[] | null): AiAccess => ({
    workspaceId: 'w1',
    workspaceName: 'ACADEMY',
    timezone: 'Asia/Tomsk',
    ownerId: 'owner',
    userId: 'u1',
    roleName: 'admin',
    isOwner: false,
    directionIds,
})

const GROUP = '0b5f2c4e-1a2b-4c3d-8e9f-0123456789ab'
const PLAN = '1c6a3d5f-2b3c-4d4e-9f0a-123456789abc'

describe('ai-chat utils', () => {
    it('labels every MCP tool for the progress line', () => {
        expect(toolLabelKeys().sort()).toEqual(MCP_READ_TOOLS.map((t) => t.name).sort())
        expect(toolLabel('abonement_states')).toBe('Смотрю абонементы…')
        expect(toolLabel('whatever')).toBe('Смотрю данные клуба…')
    })

    it('tells the model its scope, the date and the pseudonym rules', () => {
        const admin = buildSystemPrompt(access(null), '2026-11-02', vocabularyForWorkspaceType('GRAPPLING'))
        expect(admin).toContain('«ACADEMY»')
        expect(admin).toContain('Сегодня 2026-11-02')
        expect(admin).toContain('включая выручку')
        expect(admin).toContain('m_0123456789')
        expect(admin).toContain('[group:ID]')
        expect(admin).toContain('Сверяй период')
        expect(admin).toContain('Никогда не проси у пользователя псевдоним')
        expect(
            buildSystemPrompt(access(['bjj']), '2026-11-02', vocabularyForWorkspaceType('GRAPPLING')),
        ).toContain('только направления')
        expect(
            buildSystemPrompt(access(null), '2026-11-02', vocabularyForWorkspaceType('DANCE')),
        ).toContain('«педагог»')
    })

    it('titles a conversation by its first question', () => {
        expect(conversationTitle('  Кому\nпозвонить   сегодня? ')).toBe('Кому позвонить сегодня?')
        expect(conversationTitle('я'.repeat(200))).toHaveLength(80)
        expect(conversationTitle('   ')).toBe('Новый диалог')
    })

    it('drops malformed stored entries and refs', () => {
        expect(
            parseStoredMessages([
                { role: 'user', content: 'a', text: 'a', at: 'x' },
                { role: 'robot' },
                null,
                { role: 'tool', toolCallId: '1', name: 'n', content: 'c', isError: false },
            ]).map((m) => m.role),
        ).toEqual(['user', 'tool'])
        expect(parseStoredMessages('nope')).toEqual([])
        expect(
            parseStoredRefs({
                m_0123456789: { kind: 'member', userId: 'u2' },
                bad: { kind: 'member', userId: 'u3' },
                c_abcdefabcd: { kind: 'boss', userId: 'u4' },
            }),
        ).toEqual({ m_0123456789: { kind: 'member', userId: 'u2' } })
        expect(parseStoredRefs([1, 2])).toEqual({})
    })

    const history: StoredChatMessage[] = [
        { role: 'user', content: 'Кто m_0123456789?', text: 'Кто Иван Петров?', at: '2026-11-01T10:00:00Z' },
        { role: 'assistant', content: 'Смотрю.', toolCalls: [{ id: 'c1', name: 'member_profile', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c1', name: 'member_profile', content: 'x'.repeat(5000), isError: false },
        { role: 'assistant', content: 'Это m_0123456789 из [group:' + GROUP + '].' },
        { role: 'user', content: 'Ещё?', text: 'Ещё?', at: '2026-11-01T10:05:00Z' },
        { role: 'assistant', content: '', error: 'ИИ-сервис ответил ошибкой 500' },
        { role: 'user', content: 'Выручка?', text: 'Выручка?', at: '2026-11-01T10:06:00Z' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'revenue_report', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c2', name: 'revenue_report', content: 'y'.repeat(5000), isError: true },
    ]

    it('replays the conversation for the model: pseudonymized content only, old tool answers shortened, failures skipped', () => {
        const messages = buildModelMessages('SYSTEM', history)
        expect(messages[0]).toEqual({ role: 'system', content: 'SYSTEM' })
        expect(messages.map((m) => m.role)).toEqual([
            'system',
            'user',
            'assistant',
            'tool',
            'assistant',
            'user',
            'user',
            'assistant',
            'tool',
        ])
        expect(JSON.stringify(messages)).not.toContain('Иван Петров')
        expect(messages[2]).toEqual({
            role: 'assistant',
            content: 'Смотрю.',
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'member_profile', arguments: '{}' } }],
        })
        const oldTool = messages[3] as { content: string }
        expect(oldTool.content.length).toBeLessThan(OLD_TOOL_RESULT_CHARS + 200)
        expect(oldTool.content).toContain('сокращён')
        expect((messages[8] as { content: string }).content).toHaveLength(5000)
        expect(messages[7]).toMatchObject({ role: 'assistant', content: null })
    })

    it('turns the conversation into screen turns: question as typed, steps, joined answer, error', () => {
        const turns = deriveTurns(history)
        expect(turns).toHaveLength(3)
        expect(turns[0]).toEqual({
            question: 'Кто Иван Петров?',
            askedAt: '2026-11-01T10:00:00Z',
            steps: [{ tool: 'member_profile', label: 'Открываю карточку участника…', isError: false }],
            answer: `Смотрю.\n\nЭто m_0123456789 из [group:${GROUP}].`,
            error: null,
        })
        expect(turns[1]).toMatchObject({ answer: '', error: 'ИИ-сервис ответил ошибкой 500' })
        expect(turns[2].steps).toEqual([{ tool: 'revenue_report', label: 'Считаю выручку…', isError: true }])
        expect(joinAnswer([' a ', '', 'b'])).toBe('a\n\nb')
    })

    it('finds the chips in an answer', () => {
        const tokens = extractEntityTokens([
            `m_0123456789 и c_abcdefabcd, [group:${GROUP}], [plan:${PLAN}], xm_0123456789, [group:not-a-uuid]`,
        ])
        expect([...tokens.refs]).toEqual(['m_0123456789', 'c_abcdefabcd'])
        expect([...tokens.groups]).toEqual([GROUP])
        expect([...tokens.plans]).toEqual([PLAN])
    })

    it('takes phones, e-mails and full names out of a question, but not dates or amounts', () => {
        const people = [
            { ref: 'm_0000000001', kind: 'member' as const, userId: 'u1', firstname: 'Иван', lastname: 'Петров' },
            { ref: 'c_0000000002', kind: 'staff' as const, userId: 'u2', firstname: 'Роман', lastname: 'Савельев' },
            { ref: 'm_0000000003', kind: 'member' as const, userId: 'u3', firstname: 'Пётр', lastname: 'Ёлкин' },
            { ref: 'm_0000000004', kind: 'member' as const, userId: 'u4', firstname: null, lastname: 'Безымянный' },
        ]
        const { content, matched } = pseudonymizeQuestion(
            'Петров Иван и ИВАН ПЕТРОВ, тренер Роман Савельев, Петр Елкин; +7 (900) 111-22-33, 89001112233, ivan@mail.ru. Выручка 150000 за 2026-10-01, Безымянный',
            people,
        )
        expect(content).toBe(
            'm_0000000001 и m_0000000001, тренер c_0000000002, m_0000000003; [телефон скрыт], [телефон скрыт], [e-mail скрыт]. Выручка 150000 за 2026-10-01, Безымянный',
        )
        expect(matched.map((p) => p.userId)).toEqual(['u1', 'u2', 'u3'])
        expect(pseudonymizeQuestion('Иванов Петр', people).content).toBe('Иванов Петр')
    })

    it('takes out full names in the other cases too, an exact match first', () => {
        const person = (ref: string, firstname: string, lastname: string) => ({
            ref,
            kind: 'member' as const,
            userId: ref,
            firstname,
            lastname,
        })
        const people = [
            person('m_0000000001', 'Константин', 'Фролов'),
            person('m_0000000002', 'Арсений', 'Ильин'),
            person('m_0000000003', 'Никита', 'Высоцкий'),
            person('m_0000000004', 'Мария', 'Сёмина'),
            person('m_0000000005', 'Павел', 'Андреев'),
            person('m_0000000006', 'Александр', 'Петров'),
            person('m_0000000007', 'Александра', 'Петрова'),
        ]
        const { content, matched } = pseudonymizeQuestion(
            'Что у Константина Фролова? Позвоню Арсению Ильину, с Никитой Высоцким, про Марию Семину, у Павла Андреева; Александра Петрова и Александром Петровым',
            people,
        )
        expect(content).toBe(
            'Что у m_0000000001? Позвоню m_0000000002, с m_0000000003, про m_0000000004, у m_0000000005; m_0000000007 и m_0000000006',
        )
        expect(matched.map((p) => p.ref)).toEqual([
            'm_0000000007',
            'm_0000000001',
            'm_0000000002',
            'm_0000000003',
            'm_0000000004',
            'm_0000000005',
            'm_0000000006',
        ])
        // Another word, not a case of the name.
        expect(pseudonymizeQuestion('Константиновка Фроловская', people).content).toBe(
            'Константиновка Фроловская',
        )
    })

    it('bounds the calendar month', () => {
        expect(monthBounds('2026-11-17')).toEqual({ from: '2026-11-01', to: '2026-12-01' })
        expect(monthBounds('2026-12-31')).toEqual({ from: '2026-12-01', to: '2027-01-01' })
    })
})
