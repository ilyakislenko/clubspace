// Pure pieces of «Спросить ИИ по видео клуба» (unit-tested in
// ask-club-videos-utils.spec.ts): the search terms (the model's expansion,
// the sport glossary's names for the same technique, a fallback from the
// question's own words), which transcript moments become excerpts and the
// text around each, what the model is told, and how its answer's [n]
// citations are checked against the excerpts it was given.
import {
    findTechniques,
    SPORT_RUSSIAN_TERMS,
    type SportType,
    techniquesFor,
} from '@clubspace/sport-glossary'
import { z } from 'zod'

import type { LlmMessage } from '../../domains/ai-assistant/llm-chat.client'
import { likePattern } from '../search-videos/search-videos-utils'

// ---- Limits ----

export const MIN_QUESTION_LENGTH = 5
// The app types the question into the search field (100 characters); a little
// room for other clients.
export const MAX_QUESTION_LENGTH = 200
// Questions one member may ask a day (club time) — so one person can't drain
// the club's monthly allowance.
export const DAILY_QUESTIONS_PER_MEMBER = 10
// Both model calls together.
export const ANSWER_TIMEOUT_MS = 30_000
export const MAX_SEARCH_TERMS = 20
export const MIN_TERM_LENGTH = 3
export const MAX_EXCERPTS = 6
export const MAX_EXCERPTS_PER_VIDEO = 2
// Hits closer than this in one video are the same moment.
export const SAME_MOMENT_SEC = 60
// Transcript around a hit: a little before, more after (the explanation
// follows the name of the move).
export const WINDOW_BEFORE_SEC = 10
export const WINDOW_AFTER_SEC = 50
export const MAX_EXCERPT_CHARS = 1000
// The snippet a citation shows in the app.
export const CITATION_SNIPPET_CHARS = 160
export const EXPANSION_MAX_TOKENS = 300
export const ANSWER_MAX_TOKENS = 700

export const NO_ANSWER_MARKER = 'NO_ANSWER'
export const NO_ANSWER_TEXT =
    'В видео клуба не нашлось ответа на этот вопрос. Попробуйте сформулировать иначе или спросите в клубе.'

// ---- Search terms ----

const SPORT_WORDS: Record<SportType, string> = {
    GRAPPLING: 'единоборства (борьба, грэпплинг)',
    FITNESS: 'фитнес',
    YOGA: 'йога',
    DANCE: 'танцы',
    CUSTOM: 'тренировки',
}

export const buildExpansionMessages = (question: string, sport: SportType): LlmMessage[] => [
    {
        role: 'system',
        content: [
            `Ты помогаешь искать по расшифровкам видеоуроков спортивного клуба (${SPORT_WORDS[sport]}). Расшифровки на русском или английском, сделаны автоматически.`,
            'По вопросу ученика верни только JSON вида {"terms": ["…"]} — до 12 коротких поисковых слов и фраз (1–2 слова), которые скорее всего прозвучат в уроке с ответом: ключевые слова вопроса в начальной форме, названия техник и позиций по-русски (как говорят спортсмены, обычно транслитом: «маунт», «гард») и по-английски, близкие синонимы.',
            'Без пояснений и без Markdown — только JSON.',
        ].join('\n'),
    },
    { role: 'user', content: question },
]

const CYRILLIC_ENDING =
    /(?:ами|ями|ого|его|ому|ему|ыми|ими|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ом|ем|ам|ям|ах|ях|ую|юю|а|я|о|е|ы|и|у|ю|ь|й)$/

/** A Russian word without its case ending, so ILIKE finds every form («маунта» → «маунт»). */
export const searchStem = (word: string): string => {
    const lower = word.toLowerCase()
    if (!/^[а-яё-]+$/.test(lower) || lower.length <= 5) return lower
    return lower.replace(CYRILLIC_ENDING, '')
}

const normalizeTerm = (raw: string): string | null => {
    const words = raw
        .toLowerCase()
        .replace(/[«»"“”„()[\]{}.,!?;:]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    if (words.length === 0) return null
    // A single Russian word loses its ending; a phrase stays as said.
    const term = words.length === 1 ? searchStem(words[0]) : words.join(' ')
    return term.length >= MIN_TERM_LENGTH ? term : null
}

/**
 * The model's `{"terms": [...]}`, tolerating a code fence or prose around it.
 * Smaller models often close the JSON wrongly (`… "sweep"}]`); then the quoted
 * strings after `"terms"` are taken as the list, so one stray bracket doesn't
 * throw away good search words.
 */
export const parseExpansionTerms = (raw: string): string[] => {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
        try {
            const result = ExpansionSchema.safeParse(JSON.parse(raw.slice(start, end + 1)))
            if (result.success) {
                return result.data.terms.filter((t): t is string => typeof t === 'string').slice(0, 20)
            }
        } catch {
            // Malformed — read the quoted strings below.
        }
    }
    const key = raw.search(/"terms"\s*:\s*\[/)
    if (key < 0) return []
    const list = raw.slice(raw.indexOf('[', key) + 1)
    const terms: string[] = []
    for (const m of list.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        let term: unknown
        try {
            term = JSON.parse(`"${m[1]}"`)
        } catch {
            continue
        }
        if (typeof term === 'string' && term.trim()) terms.push(term)
        if (terms.length === 20) break
    }
    return terms
}

const ExpansionSchema = z.object({ terms: z.array(z.unknown()) })

// Question and function words a lesson says everywhere (the glossary's
// COMMON_RUSSIAN_WORDS also lists body parts, which a question needs).
const STOP_WORDS = new Set([
    'когда', 'почему', 'зачем', 'какой', 'какая', 'какие', 'какую', 'каким', 'если',
    'чтобы', 'меня', 'тебя', 'надо', 'нужно', 'можно', 'делать', 'сделать', 'правильно',
    'лучше', 'потом', 'тогда', 'сейчас', 'очень', 'этот', 'этого', 'эту', 'этой', 'который',
    'которая', 'которые', 'будет', 'есть', 'what', 'when', 'with', 'should', 'from',
])

/** The question's own words worth searching for, when the model gave no terms. */
export const questionWords = (question: string): string[] =>
    question
        .toLowerCase()
        .split(/[^\p{L}\p{N}-]+/u)
        .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))

/**
 * The glossary's names for what the question and terms mention: a technique
 * of the club's sport in English and Russian with its spellings, and the
 * Russian/English pair of a term members say («маунт» ↔ «mount»).
 */
export const glossaryVariants = (
    texts: readonly string[],
    sport: SportType,
): string[] => {
    const out: string[] = []
    const joined = texts.join(' · ')
    for (const match of findTechniques(joined, techniquesFor(sport))) {
        const t = techniquesFor(sport).find((x) => x.key === match.key)
        if (!t) continue
        out.push(...t.spellings, ...(t.ru ? [t.ru] : []))
    }
    const lowered = texts.map((t) => t.toLowerCase())
    for (const term of SPORT_RUSSIAN_TERMS[sport]) {
        const ru = term.ru.toLowerCase()
        // A long word without its last vowel, so every case form matches.
        const ruStem = ru.length > 4 ? ru.replace(/[аяоеёиыуюьй]$/, '') : ru
        const enWord = new RegExp(`(^|[^a-z])${term.en.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^a-z])`)
        const named = lowered.some(
            (t) =>
                t === term.en ||
                t === ru ||
                (ruStem.length >= 4 && t.includes(ruStem)) ||
                (term.en.length >= 4 && enWord.test(t)),
        )
        if (named) out.push(term.en, term.ru)
    }
    return out
}

/**
 * Up to MAX_SEARCH_TERMS distinct terms: the model's first, then the
 * glossary's, then (only without the model's) the question's own words.
 */
export const buildSearchTerms = (p: {
    question: string
    expanded: readonly string[]
    sport: SportType
}): string[] => {
    const base = p.expanded.length > 0 ? [...p.expanded] : questionWords(p.question)
    const all = [...base, ...glossaryVariants([p.question, ...base], p.sport)]
    const out: string[] = []
    for (const raw of all) {
        const term = normalizeTerm(raw)
        if (term && !out.includes(term)) out.push(term)
        if (out.length >= MAX_SEARCH_TERMS) break
    }
    return out
}

export const termPatterns = (terms: readonly string[]): string[] => terms.map(likePattern)

// ---- Moments and excerpts ----

export type MomentKind = 'chapter' | 'speech' | 'speechRu'

/** One cue or chapter title of a watchable video that names a search term. */
export type MomentHitRow = {
    videoId: string
    title: string
    kind: MomentKind
    at: number
    text: string
    // How many search terms the text names; titleScore the same for the title.
    score: number
    titleScore: number
}

const momentScore = (row: MomentHitRow): number =>
    row.score + (row.titleScore > 0 ? 1 : 0) + (row.kind === 'chapter' ? 0.5 : 0)

/**
 * The best moments: most terms named first (a title naming them and a chapter
 * title count a little extra), one per SAME_MOMENT_SEC of a video, at most
 * MAX_EXCERPTS_PER_VIDEO per video and MAX_EXCERPTS in all. Only rows of
 * `watchable` videos are considered, whatever the query returned.
 */
export const pickMoments = (
    rows: readonly MomentHitRow[],
    watchable: ReadonlySet<string>,
): MomentHitRow[] => {
    const ranked = rows
        .filter((r) => watchable.has(r.videoId) && Number.isFinite(r.at))
        .map((row, order) => ({ row, order, score: momentScore(row) }))
        .sort((a, b) => b.score - a.score || a.row.at - b.row.at || a.order - b.order)
    const picked: MomentHitRow[] = []
    for (const { row } of ranked) {
        if (picked.length >= MAX_EXCERPTS) break
        const sameVideo = picked.filter((p) => p.videoId === row.videoId)
        if (sameVideo.length >= MAX_EXCERPTS_PER_VIDEO) continue
        if (sameVideo.some((p) => Math.abs(p.at - row.at) < SAME_MOMENT_SEC)) continue
        picked.push(row)
    }
    return picked
}

export type Cue = { from: number; to: number; text: string }

/** A stored cue list ([{from, to, text}]); anything else counts as none. */
export const cuesOf = (value: unknown): Cue[] =>
    Array.isArray(value)
        ? value.flatMap((c) => {
              if (typeof c !== 'object' || c === null) return []
              const { from, to, text } = c as Record<string, unknown>
              if (typeof from !== 'number' || typeof text !== 'string') return []
              return [{ from, to: typeof to === 'number' ? to : from, text }]
          })
        : []

/** The cues an excerpt reads from: the Russian translation when there is one. */
export const excerptCues = (transcript: { segments: unknown; translations: unknown } | undefined): Cue[] => {
    if (!transcript) return []
    const { translations } = transcript
    const ru = cuesOf(
        translations && typeof translations === 'object' && 'ru' in translations
            ? translations.ru
            : null,
    )
    return ru.length > 0 ? ru : cuesOf(transcript.segments)
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

const cut = (text: string, max: number): string => {
    if (text.length <= max) return text
    const head = text.slice(0, max)
    const space = head.lastIndexOf(' ')
    return `${space > max / 2 ? head.slice(0, space) : head}…`
}

export type Excerpt = {
    n: number
    videoId: string
    title: string
    // The chapter title when the moment is a chapter.
    chapter: string | null
    startAt: number
    endAt: number | null
    // What the model reads.
    text: string
    // What the app shows under the citation.
    snippet: string
}

/**
 * The transcript around one moment: the cues overlapping
 * [at − WINDOW_BEFORE_SEC, at + WINDOW_AFTER_SEC], from the first one's start
 * to the last one's end. A moment without cues there (a chapter of a video
 * with no transcript) is its own text.
 */
export const buildExcerpt = (n: number, moment: MomentHitRow, cues: readonly Cue[]): Excerpt => {
    const from = moment.at - WINDOW_BEFORE_SEC
    const to = moment.at + WINDOW_AFTER_SEC
    const window = cues.filter((c) => c.to > from && c.from < to && collapse(c.text))
    const own = collapse(moment.text)
    const text = window.length > 0 ? collapse(window.map((c) => c.text).join(' ')) : own
    return {
        n,
        videoId: moment.videoId,
        title: moment.title,
        chapter: moment.kind === 'chapter' ? own : null,
        startAt: Math.max(0, Math.floor(window.length > 0 ? Math.min(window[0].from, moment.at) : moment.at)),
        endAt: window.length > 0 ? Math.ceil(Math.max(...window.map((c) => c.to))) : null,
        text: cut(text, MAX_EXCERPT_CHARS),
        snippet: cut(own, CITATION_SNIPPET_CHARS),
    }
}

const clock = (sec: number): string => {
    const s = Math.max(0, Math.floor(sec))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const pad = (x: number) => String(x).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

// ---- The answer ----

export const buildAnswerMessages = (question: string, excerpts: readonly Excerpt[]): LlmMessage[] => [
    {
        role: 'system',
        content: [
            'Ты отвечаешь ученику спортивного клуба на вопрос по видеоурокам этого клуба. Тебе даны отрывки расшифровок видео клуба, пронумерованные [1], [2] и т. д.',
            'Отвечай по-русски, коротко: до 5–6 предложений или короткий список шагов. Используй только то, что сказано в отрывках: никаких советов и подробностей из своих знаний, ничего не додумывай.',
            'После каждого утверждения ставь номер отрывка, на котором оно основано, в квадратных скобках: [1] или [2][3]. Не пиши слово «отрывок» — говори «в видео».',
            'Расшифровки сделаны автоматически и могут содержать ошибки распознавания — понимай их по смыслу.',
            `Если в отрывках нет ответа на вопрос, ответь ровно одним словом ${NO_ANSWER_MARKER}.`,
        ].join('\n'),
    },
    {
        role: 'user',
        content: [
            `Вопрос: ${question}`,
            '',
            'Отрывки:',
            ...excerpts.map(
                (e) =>
                    `[${e.n}] Видео «${e.title}»${e.chapter ? `, глава «${e.chapter}»` : ''}, ${clock(e.startAt)}${e.endAt !== null ? `–${clock(e.endAt)}` : ''}\n${e.text}`,
            ),
        ].join('\n'),
    },
]

/**
 * The model's answer with only real citations: `[1, 2]` becomes `[1][2]`,
 * a number that isn't an excerpt is dropped, the rest are renumbered 1, 2, …
 * in the order they first appear. `cited[i]` is the excerpt number of the new
 * `[i + 1]`. Null when there is no answer: the model said NO_ANSWER, said
 * nothing, or cited none of the excerpts (an uncited answer may come from its
 * own knowledge, which the product doesn't give).
 */
export const parseAnswer = (
    raw: string,
    excerptNumbers: readonly number[],
): { answer: string; cited: number[] } | null => {
    const text = raw.trim()
    if (!text || text.includes(NO_ANSWER_MARKER)) return null
    const valid = new Set(excerptNumbers)
    const cited: number[] = []
    const expanded = text.replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (_m, list: string) =>
        list
            .split(/\s*[,;]\s*/)
            .map((n) => `[${n}]`)
            .join(''),
    )
    const answer = expanded
        .replace(/\[(\d+)\]/g, (_m, digits: string) => {
            const n = Number(digits)
            if (!valid.has(n)) return ''
            if (!cited.includes(n)) cited.push(n)
            return `[${cited.indexOf(n) + 1}]`
        })
        .replace(/[ \t]+([.,;:!?])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
    if (cited.length === 0) return null
    return { answer, cited }
}
