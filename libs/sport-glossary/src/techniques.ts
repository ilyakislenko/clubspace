import {
    SPORT_RUSSIAN_TERMS,
    SPORT_TERM_SECTIONS,
    type SportType,
    type TechniqueCategory,
} from './glossary.js'

// «Техники»: the glossary's categorized terms as a catalogue of techniques,
// and where they occur in a lesson — chapter titles (strong) and what is said
// (weak). Pure: the worker indexes lessons with it, the server re-indexes
// chapters a coach edits by hand.

export const TECHNIQUE_CATEGORIES: readonly TechniqueCategory[] = [
    'submissions',
    'guards',
    'passes',
    'sweeps',
    'takedowns',
    'positions',
    'escapes',
    'other',
]

export const TECHNIQUE_CATEGORY_LABELS: Record<TechniqueCategory, string> = {
    submissions: 'Болевые и удушающие',
    guards: 'Гарды',
    passes: 'Проходы гарда',
    sweeps: 'Свипы',
    takedowns: 'Тейкдауны и броски',
    positions: 'Позиции и контроль',
    escapes: 'Выходы и уходы',
    other: 'Техники и упражнения',
}

// Spellings the glossary lists separately (for Whisper) that are one
// technique in the catalogue: alias → canonical.
const TECHNIQUE_ALIASES: Partial<Record<SportType, Readonly<Record<string, string>>>> = {
    GRAPPLING: {
        'Triangle Choke': 'Triangle',
        'Darce Choke': 'Darce',
        'Anaconda Choke': 'Anaconda',
        'Ezekiel Choke': 'Ezekiel',
        'Bow and Arrow Choke': 'Bow and Arrow',
        'Deep Half Guard': 'Deep Half',
        SLX: 'Single Leg X',
        'Knee Slice': 'Knee Cut',
    },
}

export interface Technique {
    /** Stable id: the canonical English term as a slug («rear-naked-choke»). */
    key: string
    /** The canonical English term. */
    en: string
    /** How members say it in Russian, when the glossary knows. */
    ru: string | null
    category: TechniqueCategory
    /** The English spellings that name it (canonical first). */
    spellings: readonly string[]
}

export const techniqueKey = (en: string): string =>
    en
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

const catalogues = new Map<SportType, readonly Technique[]>()

/** The sport's techniques, in glossary order. A CUSTOM club has none. */
export const techniquesFor = (sport: SportType): readonly Technique[] => {
    const cached = catalogues.get(sport)
    if (cached) return cached
    const aliases = TECHNIQUE_ALIASES[sport] ?? {}
    const russian = SPORT_RUSSIAN_TERMS[sport]
    const list: Technique[] = []
    for (const section of SPORT_TERM_SECTIONS[sport]) {
        if (!section.category) continue
        for (const term of section.terms) {
            if (aliases[term]) continue
            list.push({
                key: techniqueKey(term),
                en: term,
                ru: russian.find((r) => r.en === term.toLowerCase())?.ru ?? null,
                category: section.category,
                spellings: [
                    term,
                    ...Object.keys(aliases).filter((alias) => aliases[alias] === term),
                ],
            })
        }
    }
    catalogues.set(sport, list)
    return list
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])'
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])'

// An English spelling: whole words, any case, spaces and hyphens alike.
const englishPattern = (spelling: string) =>
    NOT_WORD_BEFORE +
    spelling.split(/[\s-]+/).map(escapeRegExp).join('[\\s-]+') +
    NOT_WORD_AFTER

// A Russian form in any case ending: each word's stem (a long word loses its
// final vowel) and whatever ending follows («кимура» → «кимурой»).
const russianPattern = (ru: string) =>
    NOT_WORD_BEFORE +
    ru
        .split(/[\s-]+/)
        .map((word) => {
            const stem = word.length > 4 ? word.replace(/[аяоеёиыуюьй]$/i, '') : word
            return `${escapeRegExp(stem)}\\p{L}*`
        })
        .join('[\\s-]+')

const patterns = new WeakMap<Technique, RegExp>()
const patternOf = (t: Technique): RegExp => {
    let re = patterns.get(t)
    if (!re) {
        const alternatives = [
            // Longer spellings first: the regex takes the first that matches.
            ...[...t.spellings].sort((a, b) => b.length - a.length).map(englishPattern),
            ...(t.ru ? [russianPattern(t.ru)] : []),
        ]
        re = new RegExp(alternatives.join('|'), 'giu')
        patterns.set(t, re)
    }
    return re
}

export interface TechniqueMatch {
    key: string
    start: number
    end: number
}

/**
 * The techniques named in `text`. Where names overlap the longest wins
 * («Inside Heel Hook» is not also a «Heel Hook», «Technical Mount» not a
 * «Mount»); a tie goes to the technique listed first. In text order.
 */
export const findTechniques = (
    text: string,
    techniques: readonly Technique[],
): TechniqueMatch[] => {
    const all: TechniqueMatch[] = []
    for (const t of techniques) {
        for (const m of text.matchAll(patternOf(t))) {
            const start = m.index ?? 0
            all.push({ key: t.key, start, end: start + m[0].length })
        }
    }
    const kept: TechniqueMatch[] = []
    for (const m of all
        .map((match, order) => ({ match, order }))
        .sort(
            (a, b) =>
                b.match.end - b.match.start - (a.match.end - a.match.start) ||
                a.order - b.order,
        )
        .map((x) => x.match)) {
        if (kept.every((k) => m.end <= k.start || m.start >= k.end)) kept.push(m)
    }
    return kept.sort((a, b) => a.start - b.start)
}

export type TechniqueMentionKind = 'chapter' | 'speech' | 'speechRu'

export interface TechniqueMention {
    technique: string
    kind: TechniqueMentionKind
    atSec: number
    /** The chapter title or the cue said there (the snippet's source). */
    text: string
    /** The words that named the technique, as written in `text`. */
    matched: string
}

type Cue = { from: number; text: string }

// A stored cue list ([{from, to, text}]); anything else counts as none.
const cuesOf = (value: unknown): Cue[] =>
    Array.isArray(value)
        ? value.filter(
              (c): c is Cue =>
                  typeof c === 'object' &&
                  c !== null &&
                  typeof (c as Cue).from === 'number' &&
                  typeof (c as Cue).text === 'string',
          )
        : []

// Stored text is kept to this length (a cue is a sentence or two).
const MAX_TEXT = 500

/**
 * Every technique mention of one lesson: its chapter titles, its transcript
 * and the transcript's Russian translation. One per technique, kind and
 * second.
 */
export const extractTechniqueMentions = (input: {
    sport: SportType
    chapters: readonly { positionSec: number; title: string }[]
    segments?: unknown
    ruSegments?: unknown
}): TechniqueMention[] => {
    const techniques = techniquesFor(input.sport)
    if (techniques.length === 0) return []
    const out: TechniqueMention[] = []
    const seen = new Set<string>()
    const scan = (kind: TechniqueMentionKind, atSec: number, rawText: string) => {
        const text = rawText.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
        for (const m of findTechniques(text, techniques)) {
            const at = Math.max(0, Math.floor(atSec))
            const id = `${m.key}|${kind}|${at}`
            if (seen.has(id)) continue
            seen.add(id)
            out.push({
                technique: m.key,
                kind,
                atSec: at,
                text,
                matched: text.slice(m.start, m.end),
            })
        }
    }
    for (const c of input.chapters) scan('chapter', c.positionSec, c.title)
    for (const c of cuesOf(input.segments)) scan('speech', c.from, c.text)
    for (const c of cuesOf(input.ruSegments)) scan('speechRu', c.from, c.text)
    return out
}
