import { BODY_WORDS, COMMON_ENGLISH_WORDS } from './common-english-words.js'
import { COMMON_RUSSIAN_WORDS } from '@clubspace/sport-glossary'

// Snaps misread or misheard technique names to their spelling in a glossary:
// «Komura» and «Camorra» (Whisper) → «Kimura», «Sankakuh» / «Sankal» (OCR of
// a caption fading out) → «Sankaku», «Darcy choke» → «Darce choke». Applied
// to transcripts before the chat model reads them, to its chapter titles and
// to titles read off the screen. Side-effect free.
//
// A span of 1–3 words is snapped to a term when they are close in spelling
// (edit distance, stricter for short words) or sound alike (a consonant
// skeleton, Cyrillic transliterated first) — and only if a word in it is not
// an ordinary word: common English (common-english-words.ts) and Russian
// words, and the glossary's own words, are never changed. Latin snaps to
// Latin and Cyrillic to Cyrillic; a Russian word that differs from a term
// only in its ending is that term declined («кимуру»), not a misreading.

export interface GlossaryTerm {
    /** As it should be written: «Kimura», «De La Riva», «кимура». */
    canonical: string
    /** Lowercase letters only, no spaces: what spans are measured against. */
    compact: string
    key: string
    cyrillic: boolean
    words: number
}

export interface Glossary {
    /** The sport's terms, most common first (for Whisper's prompt). */
    sportTerms: readonly string[]
    terms: GlossaryTerm[]
    /** Every word of every term, lowercase: never snapped themselves. */
    words: ReadonlySet<string>
    /** Known mishearings, lowercase («ghee» → «gi»): replaced whatever their length. */
    misheard: ReadonlyMap<string, string>
}

export interface Snap {
    from: string
    to: string
}

// Words shorter than this are never snapped, nor snapped to.
const MIN_LETTERS = 4
// One edit apart is a misreading from 5 letters up — at 5 only a changed
// letter («Darcy» / «Darce»), not an added one («tuck» / «truck», another
// word) — and two from 7 up.
const ONE_EDIT_FROM = 5
const TWO_EDITS_FROM = 7
// Sounding alike (same consonant skeleton) counts from 6 letters up, as long
// as the spellings are not further apart than this share of the longer one
// («camorra» / «kimura»: 4 of 7).
const SOUND_ALIKE_FROM = 6
const SOUND_ALIKE_MAX_DISTANCE = 0.6
// A Russian word whose difference from a term is in its last letters is the
// term declined.
const RUSSIAN_ENDING = 2
// What English adds to a term without misreading it: «Kimuras», «sprawled».
const ENGLISH_ENDINGS = ['s', 'es', 'ed', 'ing', 'er', 'ers']
// Vowels a Russian case ending ends in.
const RUSSIAN_VOWELS = 'аяуюеэиыоё'
// The longest span tried, in words.
const MAX_SPAN_WORDS = 3

const CYRILLIC: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

const isCyrillic = (text: string) => /\p{Script=Cyrillic}/u.test(text)

/** Lowercase letters only: «Inside Sankaku» → «insidesankaku». */
const compactOf = (text: string) => (text.toLowerCase().match(/\p{L}/gu) ?? []).join('').replace(/ё/g, 'е')

/**
 * How a word sounds, roughly: its first letter, then its consonants, with
 * the usual spellings of one sound merged (c/k/q, ph/f, z/s) and doubles
 * collapsed. «Kimura», «Komura» and «Camorra» are all «kmr».
 */
export const phoneticKey = (word: string) => {
    const latin = [...compactOf(word)].map((ch) => CYRILLIC[ch] ?? ch).join('')
    const merged = latin
        .replace(/[^a-z]/g, '')
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/q/g, 'k')
        .replace(/x/g, 'ks')
        .replace(/c(?=[eiy])/g, 's')
        .replace(/c/g, 'k')
        .replace(/z/g, 's')
    return (merged.slice(0, 1) + merged.slice(1).replace(/[aeiouyhw]/g, '')).replace(/(.)\1+/g, '$1')
}

const levenshtein = (a: string, b: string) => {
    let previous = Array.from({ length: b.length + 1 }, (_, idx) => idx)
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i]
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
        }
        previous = current
    }
    return previous[b.length]
}

/** An ordinary word: never snapped. */
export const isCommonWord = (word: string) => {
    const lower = word.toLowerCase().replace(/ё/g, 'е')
    return COMMON_ENGLISH_WORDS.has(lower) || BODY_WORDS.has(lower) || COMMON_RUSSIAN_WORDS.has(lower)
}

const termOf = (canonical: string): GlossaryTerm => ({
    canonical,
    compact: compactOf(canonical),
    key: phoneticKey(canonical),
    cyrillic: isCyrillic(canonical),
    words: canonical.split(/\s+/).length,
})

/**
 * A club's own vocabulary from its titles: a manual chapter title of up to
 * three words as a phrase («Breaking the Kimura Grip» is not one), and every
 * uncommon word of 4+ letters of any title («Octopus», «Sankaku», «Danaher»).
 * Only titles people wrote — never automatic chapters, whose misreadings
 * would then confirm themselves.
 */
export const clubTerms = (titles: readonly string[], manualChapterTitles: readonly string[]) => {
    const terms = new Map<string, string>()
    const add = (term: string) => {
        const compact = compactOf(term)
        if (compact.length >= MIN_LETTERS && !terms.has(compact)) terms.set(compact, term)
    }
    for (const title of manualChapterTitles) {
        const phrase = title.trim().replace(/\s+/g, ' ')
        if (phrase.split(' ').length <= MAX_SPAN_WORDS && /^[\p{L}\s'’-]+$/u.test(phrase)) add(phrase)
    }
    for (const title of [...titles, ...manualChapterTitles]) {
        for (const word of title.match(/\p{L}+/gu) ?? []) {
            if (!isCommonWord(word)) add(word)
        }
    }
    return [...terms.values()]
}

/** The sport's terms, then the club's — one term per spelling. */
export const buildGlossary = (
    sportTerms: readonly string[],
    club: readonly string[] = [],
    misheard: Readonly<Record<string, string>> = {},
): Glossary => {
    const terms = new Map<string, GlossaryTerm>()
    for (const canonical of [...sportTerms, ...club]) {
        const term = termOf(canonical)
        if (term.compact.length >= MIN_LETTERS && !terms.has(term.compact)) {
            terms.set(term.compact, term)
        }
    }
    const list = [...terms.values()]
    return {
        sportTerms,
        terms: list,
        words: new Set(list.flatMap((term) => term.canonical.toLowerCase().split(/[\s-]+/))),
        misheard: new Map(Object.entries(misheard)),
    }
}

/**
 * Edit distance from a span to a term, when it is a misreading of it; null
 * otherwise — including a span of another number of words: a misread word
 * stays one word («Half-Guard» is not «Half Guard» misread), and folding a
 * neighbour in («Комура и» → «Кимура») eats real text.
 */
const misreadingDistance = (
    span: { compact: string; key: string; cyrillic: boolean; words: number },
    term: GlossaryTerm,
) => {
    const { compact, key, cyrillic } = span
    if (term.cyrillic !== cyrillic || term.words !== span.words) return null
    const longest = Math.max(compact.length, term.compact.length)
    if (Math.abs(compact.length - term.compact.length) > 3) return null
    if (key[0] !== term.key[0]) return null
    if (cyrillic) {
        let prefix = 0
        while (prefix < compact.length && compact[prefix] === term.compact[prefix]) prefix += 1
        const shortest = Math.min(compact.length, term.compact.length)
        if (prefix >= shortest - RUSSIAN_ENDING) return null
    } else if (
        compact.startsWith(term.compact) &&
        ENGLISH_ENDINGS.includes(compact.slice(term.compact.length))
    ) {
        // «Kimuras», «armbars», «sprawled»: the term itself, inflected.
        return null
    }
    const distance = levenshtein(compact, term.compact)
    const close =
        (distance <= 1 &&
            longest >= ONE_EDIT_FROM &&
            (longest > ONE_EDIT_FROM || compact.length === term.compact.length)) ||
        (distance <= 2 && longest >= TWO_EDITS_FROM) ||
        // Sounding alike only word for word: across words too many phrases
        // share a skeleton («Hip Scoop» / «Hip Escape»).
        (span.words === 1 &&
            key === term.key &&
            longest >= SOUND_ALIKE_FROM &&
            distance / longest <= SOUND_ALIKE_MAX_DISTANCE)
    return close ? distance : null
}

// One word of the term in the case style of the word it replaces.
const styleWord = (word: string, original: string) => {
    if (/\p{Lu}/u.test(original) && !/\p{Ll}/u.test(original) && original.length > 1) {
        return word.toUpperCase()
    }
    if (/^\P{L}*\p{Lu}/u.test(original)) return word.charAt(0).toUpperCase() + word.slice(1)
    // Lowercase text keeps a term's acronyms: «slx» → «SLX».
    return word.length > 1 && word === word.toUpperCase() && /\p{L}/u.test(word)
        ? word
        : word.toLowerCase()
}

/**
 * The term's spelling in the case style of what it replaces, word for word:
 * «Darcy choke» → «Darce choke», «SANKAKUH» → «SANKAKU», «camorra» → «kimura».
 */
const styled = (canonical: string, original: string) => {
    const originals = original.split(/\s+/)
    return canonical
        .split(' ')
        .map((word, idx) => styleWord(word, originals[idx]))
        .join(' ')
}

/** The term a span of words is a misreading of, spelled for the span; null if none. */
const misreadTerm = (original: string, words: number, glossary: Glossary) => {
    const compact = compactOf(original)
    const measured = {
        compact,
        key: phoneticKey(compact),
        cyrillic: isCyrillic(original),
        words,
    }
    // The closest term; the commonest (first listed) on a tie.
    let best: { term: GlossaryTerm; distance: number } | null = null
    for (const term of glossary.terms) {
        const distance = misreadingDistance(measured, term)
        if (distance !== null && (!best || distance < best.distance)) {
            best = { term, distance }
        }
    }
    if (!best) return null
    const to = styled(best.term.canonical, original)
    // A misread Russian term keeps its case ending: «комуру» → «кимуру», not
    // the nominative «кимура».
    const ending = original.slice(-1)
    return measured.cyrillic &&
        RUSSIAN_VOWELS.includes(ending.toLowerCase()) &&
        RUSSIAN_VOWELS.includes(to.slice(-1).toLowerCase())
        ? to.slice(0, -1) + ending
        : to
}

/** Replaces misread terms in `text` with the glossary's spelling. */
export const snapTerms = (text: string, glossary: Glossary): { text: string; snaps: Snap[] } => {
    const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)].map((match) => ({
        word: match[0],
        start: match.index as number,
        end: (match.index as number) + match[0].length,
    }))
    // A word that may be snapped: neither short, nor ordinary, nor already a
    // glossary word (all parts of «Half-Guard» are).
    const unknown = tokens.map(
        (token) =>
            /^\p{L}/u.test(token.word) &&
            token.word.length >= MIN_LETTERS &&
            !token.word
                .split(/['’-]/)
                .every(
                    (part) =>
                        part.length < MIN_LETTERS ||
                        isCommonWord(part) ||
                        glossary.words.has(part.toLowerCase()),
                ),
    )

    const snaps: Snap[] = []
    let result = ''
    let cursor = 0
    for (let idx = 0; idx < tokens.length; idx += 1) {
        let replaced = 0
        for (let words = Math.min(MAX_SPAN_WORDS, tokens.length - idx); words >= 1; words -= 1) {
            const span = tokens.slice(idx, idx + words)
            // One phrase: words apart by spaces only — a known mishearing, or
            // a misreading with at least one unfamiliar word.
            const joined = span
                .slice(1)
                .every((token, k) => /^\s+$/.test(text.slice(span[k].end, token.start)))
            if (!joined) continue
            const original = text.slice(span[0].start, span[span.length - 1].end)
            const heard = glossary.misheard.get(original.toLowerCase().replace(/\s+/g, ' '))
            const to =
                heard !== undefined
                    ? styled(heard, original)
                    : unknown.slice(idx, idx + words).some(Boolean)
                      ? misreadTerm(original, words, glossary)
                      : null
            if (to === null) continue
            result += text.slice(cursor, span[0].start) + to
            cursor = span[span.length - 1].end
            snaps.push({ from: original, to })
            replaced = words
            break
        }
        if (replaced > 0) idx += replaced - 1
    }
    return { text: result + text.slice(cursor), snaps }
}

/** «Komura→Kimura ×2» per distinct snap, for the log. */
export const describeSnaps = (snaps: readonly Snap[]) => {
    const counts = new Map<string, number>()
    for (const snap of snaps) {
        const label = `${snap.from}→${snap.to}`
        counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
}
