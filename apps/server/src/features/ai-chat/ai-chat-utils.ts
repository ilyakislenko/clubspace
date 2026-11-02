// Pure pieces of the admin's «ИИ-ассистент» chat (unit-tested in
// ai-chat-utils.spec.ts): what the model is told, how a saved conversation
// becomes the next request and the screen's turns, how the question is
// pseudonymized before it leaves, and which tokens in an answer are chips.
import { z } from 'zod'

import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import { PSEUDONYM_RE } from '../../domains/ai-assistant/pseudonym'
import type { LlmMessage } from '../../domains/ai-assistant/llm-chat.client'
import type { ClubVocabulary } from '../../shared/utils/club-vocabulary'

// ---- Stored conversation ----

const StoredToolCallSchema = z.object({ id: z.string(), name: z.string(), arguments: z.string() })
export type StoredToolCall = z.infer<typeof StoredToolCallSchema>

// One entry of AiChatConversation.messages. `content` is what the model saw;
// a user entry also keeps `text` — the question as typed, for the screen only.
const StoredChatMessageSchema = z.union([
    z.object({ role: z.literal('user'), content: z.string(), text: z.string(), at: z.string() }),
    z.object({
        role: z.literal('assistant'),
        content: z.string(),
        toolCalls: z.array(StoredToolCallSchema).optional(),
        // The turn failed or was stopped: shown, never sent back to the model.
        error: z.string().optional(),
    }),
    z.object({
        role: z.literal('tool'),
        toolCallId: z.string(),
        name: z.string(),
        content: z.string(),
        isError: z.boolean(),
    }),
])
export type StoredChatMessage = z.infer<typeof StoredChatMessageSchema>

// A saved row is our own write, but a malformed entry must not break the page:
// it is dropped.
export const parseStoredMessages = (raw: unknown): StoredChatMessage[] =>
    Array.isArray(raw)
        ? raw.flatMap((m) => {
              const parsed = StoredChatMessageSchema.safeParse(m)
              return parsed.success ? [parsed.data] : []
          })
        : []

const PersonRefSchema = z.object({ kind: z.enum(['member', 'staff']), userId: z.string() })
export type StoredRefs = Record<string, z.infer<typeof PersonRefSchema>>

export const parseStoredRefs = (raw: unknown): StoredRefs => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(raw)
    if (!parsed.success) return {}
    const out: StoredRefs = {}
    for (const [ref, value] of Object.entries(parsed.data)) {
        const person = PersonRefSchema.safeParse(value)
        if (PSEUDONYM_RE.test(ref) && person.success) out[ref] = person.data
    }
    return out
}

// ---- Limits of one turn ----

// Model ↔ tools round trips per question; the last round gets no tools so the
// model has to answer with what it has.
export const MAX_TOOL_ROUNDS = 6
export const MAX_ANSWER_TOKENS = 1500
export const MAX_QUESTION_CHARS = 2000
// Tool answers of earlier questions are replayed shortened: the model keeps
// the gist (and the refs at the top) without paying for 60k characters again.
export const OLD_TOOL_RESULT_CHARS = 4000
// A conversation longer than this many questions asks for a new one.
export const MAX_QUESTIONS_PER_CONVERSATION = 30

export const TITLE_MAX = 80

export const conversationTitle = (question: string): string => {
    const line = question.replace(/\s+/g, ' ').trim()
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line || 'Новый диалог'
}

// ---- What the model is told ----

export const SUGGESTED_QUESTIONS = [
    'Кому позвонить сегодня?',
    'Выручка по направлениям за 3 месяца',
    'Слабые слоты расписания',
    'Кому пора продлевать абонемент?',
] as const

export const buildSystemPrompt = (
    access: AiAccess,
    today: string,
    vocabulary: ClubVocabulary,
): string =>
    [
        `Ты — ИИ-ассистент ClubSpace внутри админки клуба «${access.workspaceName}». Сегодня ${today}, часовой пояс клуба ${access.timezone}.`,
        'Отвечай по-русски, коротко и по делу: сначала вывод, потом детали. Можно Markdown: списки, **жирный**, таблицы. Не выдумывай цифры и выводы — бери их из инструментов; если нужных данных нет, так и скажи.',
        'Сверяй период и даты в ответе инструмента с вопросом: если инструмент вернул не тот период, вызови его с другими параметрами или прямо скажи, за какой период цифры. Прошедшую дату не выдавай за будущую.',
        'Доли от 0 до 1 из инструментов (rate, fill) пиши процентами: 0.83 → 83%. Даты — по-русски: 6 ноября, а не 2026-11-06. Сравнивая, ставь лучших первыми.',
        'Пиши только по-русски: ни одного английского слова, даже в скобках как пояснение — «доля продлений», а не «доля продлений (retention rate)»; «заполненность», а не «fill». Названия полей инструментов в ответ не переноси.',
        access.directionIds === null
            ? 'Доступ: весь клуб, включая выручку и долги.'
            : 'Доступ: только направления, которыми руководит сотрудник; финансовых инструментов нет — если спросят про деньги, объясни, что это видит администратор клуба.',
        'Инструменты только читают данные. Начинай с club_overview или club_directory, если нужны id направлений, групп, залов и тарифов. Суммы — в целых единицах валюты клуба; время — местное время зала. Длинные списки постраничны (offset/limit, nextOffset).',
        `Люди обозначены псевдонимами: ученики — m_0123456789, ${vocabulary.coach.nomPl} — c_0123456789. Имён, телефонов и e-mail у тебя нет и быть не должно. Упоминая человека, пиши его псевдоним как есть, без кавычек и скобок, — админка сама покажет имя и ссылку на карточку. Никогда не придумывай имена.`,
        `Слова клуба: занятие по расписанию — «${vocabulary.session.nom}», сотрудник с ролью coach — «${vocabulary.coach.nom}», главный — «${vocabulary.headCoach.nom}», индивидуальное — «${vocabulary.personalSession.nom}». Пиши в ответе именно эти слова.`,
        'Если в вопросе человек назван по имени, а не псевдонимом, — админка не узнала его: попроси написать имя и фамилию полностью, как в карточке участника. Никогда не проси у пользователя псевдоним или ref — он их не видит.',
        'Группы и тарифы (абонементы) — как люди: у каждой группы и тарифа в ответе инструмента есть метка — поле ref (или groupRef / tariffRef) вида [group:ID] или [plan:ID]. Упоминая группу или тариф, пиши только эту метку, как есть, — админка покажет название ссылкой на страницу группы или тарифа. Название группы или тарифа текстом не пиши — ни вместо метки, ни рядом с ней, ни в скобках после неё, ни в таблице. Если у группы или тарифа метки нет, возьми id из club_directory и напиши [group:ID] / [plan:ID]. Пример: «Пустует [group:ID] по вторникам в 19:00», а не «Пустует группа «Дети 7–10»».',
        'Не рассказывай про инструменты, их названия и параметры — говори как человек: «посмотрел абонементы», а не «вызвал abonement_states».',
    ].join('\n')

// ---- Request to the model ----

const shorten = (text: string, max: number): string =>
    text.length > max
        ? `${text.slice(0, max)}… [ответ инструмента из прошлого вопроса сокращён — при необходимости вызовите инструмент снова]`
        : text

// The saved exchange as chat-completions messages. Only pseudonymized content
// goes in (never `text`); failed answers are skipped; tool answers before the
// last question are shortened.
export const buildModelMessages = (
    system: string,
    history: readonly StoredChatMessage[],
): LlmMessage[] => {
    const lastUser = history.map((m) => m.role).lastIndexOf('user')
    const out: LlmMessage[] = [{ role: 'system', content: system }]
    history.forEach((m, i) => {
        if (m.role === 'user') {
            out.push({ role: 'user', content: m.content })
        } else if (m.role === 'assistant') {
            if (m.error && !m.content) return
            if (m.toolCalls?.length) {
                out.push({
                    role: 'assistant',
                    content: m.content || null,
                    tool_calls: m.toolCalls.map((c) => ({
                        id: c.id,
                        type: 'function' as const,
                        function: { name: c.name, arguments: c.arguments },
                    })),
                })
            } else if (m.content) {
                out.push({ role: 'assistant', content: m.content })
            }
        } else {
            out.push({
                role: 'tool',
                tool_call_id: m.toolCallId,
                content: i < lastUser ? shorten(m.content, OLD_TOOL_RESULT_CHARS) : m.content,
            })
        }
    })
    return out
}

// ---- Turns for the screen ----

export type ChatStep = { tool: string; label: string; isError: boolean }

export type ChatTurn = {
    question: string
    askedAt: string
    steps: ChatStep[]
    answer: string
    error: string | null
}

const TOOL_LABELS: Record<string, string> = {
    club_directory: 'Смотрю справочник клуба…',
    club_overview: 'Смотрю сводку по клубу…',
    revenue_report: 'Считаю выручку…',
    search_members: 'Ищу участников…',
    member_profile: 'Открываю карточку участника…',
    at_risk_members: 'Смотрю, кто может уйти…',
    renewals_due: 'Смотрю, кому пора продлевать…',
    unpaid_abonements: 'Смотрю неоплаченные абонементы…',
    abonement_states: 'Смотрю абонементы…',
    schedule: 'Смотрю расписание…',
    attendance_stats: 'Считаю посещаемость…',
    schedule_occupancy: 'Смотрю загрузку расписания…',
    coach_stats: 'Смотрю показатели тренеров…',
    rank_distribution: 'Смотрю пояса и ранги…',
    upcoming_gradings: 'Смотрю аттестации…',
    list_events: 'Смотрю мероприятия…',
}

export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? 'Смотрю данные клуба…'

export const toolLabelKeys = (): string[] => Object.keys(TOOL_LABELS)

// Answer pieces of one turn (text before a tool round, the final answer) are
// joined with a blank line — the same text the stream showed live.
export const joinAnswer = (parts: readonly string[]): string =>
    parts
        .map((p) => p.trim())
        .filter(Boolean)
        .join('\n\n')

export const deriveTurns = (history: readonly StoredChatMessage[]): ChatTurn[] => {
    const turns: ChatTurn[] = []
    const errors = new Map<string, boolean>()
    for (const m of history) {
        if (m.role === 'tool') errors.set(m.toolCallId, m.isError)
    }
    let current: (ChatTurn & { parts: string[] }) | null = null
    const close = () => {
        if (!current) return
        const { parts, ...turn } = current
        turns.push({ ...turn, answer: joinAnswer(parts) })
    }
    for (const m of history) {
        if (m.role === 'user') {
            close()
            current = { question: m.text, askedAt: m.at, steps: [], answer: '', error: null, parts: [] }
        } else if (current && m.role === 'assistant') {
            if (m.content) current.parts.push(m.content)
            for (const call of m.toolCalls ?? []) {
                current.steps.push({
                    tool: call.name,
                    label: toolLabel(call.name),
                    isError: errors.get(call.id) ?? false,
                })
            }
            if (m.error) current.error = m.error
        }
    }
    close()
    return turns
}

// ---- Chips ----

// Strict uuid shape: the ids go into a uuid column query.
const ENTITY_TOKEN_RE =
    /(?<![\w])([mc]_[0-9a-f]{10})(?![\w])|\[(group|plan):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g

export type EntityTokens = { refs: Set<string>; groups: Set<string>; plans: Set<string> }

export const extractEntityTokens = (texts: readonly string[]): EntityTokens => {
    const out: EntityTokens = { refs: new Set(), groups: new Set(), plans: new Set() }
    for (const text of texts) {
        for (const m of text.matchAll(ENTITY_TOKEN_RE)) {
            if (m[1]) out.refs.add(m[1])
            else if (m[2] === 'group') out.groups.add(m[3])
            else out.plans.add(m[3])
        }
    }
    return out
}

// ---- The question, pseudonymized ----

export type KnownPerson = {
    ref: string
    kind: 'member' | 'staff'
    userId: string
    firstname: string | null
    lastname: string | null
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
const PHONE_CANDIDATE_RE = /\+?\d[\d\s()-]{8,}\d/g

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Names compared without case and with ё = е.
const fold = (s: string): string => s.toLowerCase().replace(/ё/g, 'е')

// A folded name as a pattern that takes ё for е back.
const namePattern = (folded: string): string => escapeRe(folded).replace(/е/g, '[её]')

// Endings a Russian name takes in the other cases (folded): Фролова,
// Фроловым, Никиты, Никитой, Арсения, Арсением, Высоцкого, Марии, Любовью.
const CASE_ENDINGS = [
    ...['а', 'я', 'у', 'ю', 'е', 'и', 'ы'],
    ...['ой', 'ей', 'ою', 'ею', 'ом', 'ем', 'ым', 'им', 'ью', 'ую', 'юю', 'ая', 'яя', 'ий', 'ый'],
    ...['ия', 'ию', 'ии', 'ием', 'ого', 'его', 'ому', 'ему'],
]
const CASE_ENDINGS_RE = `(?:${CASE_ENDINGS.map(namePattern).join('|')})?`

// The stems the other cases of a name are built on: the name itself
// (Фролов-а), without its last vowel, й or ь (Никит-ы, Арсени-я, Игор-я),
// without an adjective ending (Высоцк-ого, Дмитр-ия), without the fleeting е
// of -ел (Павл-а).
const nameStems = (folded: string): string[] => {
    const stems = new Set([folded])
    const adjective = /^(.{3,})(?:ий|ый|ой|ая|яя)$/.exec(folded)
    if (adjective) stems.add(adjective[1])
    const soft = /^(.{3,})[аяйьоеиыу]$/.exec(folded)
    if (soft) stems.add(soft[1])
    if (/^.{2,}ел$/.test(folded)) stems.add(`${folded.slice(0, -2)}л`)
    return [...stems]
}

// A first or last name as typed (nominative), then in any case.
const NAME_FORMS = [
    (name: string): string => namePattern(fold(name)),
    (name: string): string =>
        `(?:${nameStems(fold(name)).map(namePattern).join('|')})${CASE_ENDINGS_RE}`,
]

// E-mails and phone numbers out, full names of the club's people replaced by
// their pseudonyms (recorded in `matched`, so the answer's chips resolve).
// Names in the other cases too («у Константина Фролова»), after every exact
// match: «Александра Петрова» is her, not «Александр Петров» in the genitive.
// A date or an amount is never a phone: a phone has 10–15 digits.
export const pseudonymizeQuestion = (
    question: string,
    people: readonly KnownPerson[],
): { content: string; matched: KnownPerson[] } => {
    let content = question.replace(EMAIL_RE, '[e-mail скрыт]')
    content = content.replace(PHONE_CANDIDATE_RE, (m) => {
        const digits = m.replace(/\D/g, '').length
        return digits >= 10 && digits <= 15 ? '[телефон скрыт]' : m
    })
    const matched: KnownPerson[] = []
    for (const form of NAME_FORMS) {
        for (const p of people) {
            const first = p.firstname?.trim()
            const last = p.lastname?.trim()
            if (!first || !last) continue
            const folded = fold(content)
            if (!nameStems(fold(last)).some((stem) => folded.includes(stem))) continue
            const re = new RegExp(
                `(?<![\\p{L}])(?:${form(first)}\\s+${form(last)}|${form(last)}\\s+${form(first)})(?![\\p{L}])`,
                'giu',
            )
            if (!re.test(content)) continue
            re.lastIndex = 0
            content = content.replace(re, p.ref)
            if (!matched.includes(p)) matched.push(p)
        }
    }
    return { content, matched }
}

// ---- Monthly window ----

// First day of the month containing `ymd` (YYYY-MM-DD) and of the next one.
export const monthBounds = (ymd: string): { from: string; to: string } => {
    const [y, m] = ymd.split('-').map(Number)
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }
    const pad = (n: number) => String(n).padStart(2, '0')
    return { from: `${y}-${pad(m)}-01`, to: `${next.y}-${pad(next.m)}-01` }
}
