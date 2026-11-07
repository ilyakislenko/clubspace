// Pure helpers of «Поиск по видео»: the LIKE pattern, snippets around a hit,
// the ranking and the moments a result shows.

export const MIN_QUERY_LENGTH = 2
// Videos in one answer, and moments per video.
export const MAX_SEARCH_RESULTS = 20
export const MAX_MOMENTS_PER_VIDEO = 5
// Characters of context on each side of a hit in a snippet.
export const SNIPPET_CONTEXT = 40

/** `%q%` for ILIKE … ESCAPE '\': the member's `%`, `_` and `\` match literally. */
export const likePattern = (query: string): string =>
    `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export type Highlight = { start: number; length: number }

/** Where `query` first occurs in `text`, case-insensitively; null if not. */
export const findHit = (text: string, query: string): Highlight | null => {
    const at = text.toLowerCase().indexOf(query.toLowerCase())
    return at < 0 ? null : { start: at, length: query.length }
}

/**
 * The text around the first hit — about SNIPPET_CONTEXT characters each side,
 * cut at word boundaries, «…» where cut — with the hit's offsets in the
 * snippet for highlighting. Whitespace is collapsed first. A text the hit
 * can't be found in (the database matched it differently) gives its start,
 * unhighlighted.
 */
export const buildSnippet = (
    rawText: string,
    query: string,
): { snippet: string; highlight: Highlight | null } => {
    const text = rawText.replace(/\s+/g, ' ').trim()
    const hit = findHit(text, query)
    if (!hit) {
        if (text.length <= SNIPPET_CONTEXT * 2) return { snippet: text, highlight: null }
        const head = text.slice(0, SNIPPET_CONTEXT * 2)
        const space = head.lastIndexOf(' ')
        return { snippet: `${space > 0 ? head.slice(0, space) : head}…`, highlight: null }
    }
    let start = Math.max(0, hit.start - SNIPPET_CONTEXT)
    let end = Math.min(text.length, hit.start + hit.length + SNIPPET_CONTEXT)
    // Move the cuts outward to the nearest space, so no word is chopped.
    if (start > 0) {
        const space = text.lastIndexOf(' ', start)
        start = space < 0 ? 0 : space + 1
    }
    if (end < text.length) {
        const space = text.indexOf(' ', end)
        end = space < 0 ? text.length : space
    }
    const prefix = start > 0 ? '…' : ''
    const suffix = end < text.length ? '…' : ''
    return {
        snippet: `${prefix}${text.slice(start, end)}${suffix}`,
        highlight: { start: hit.start - start + prefix.length, length: hit.length },
    }
}

export type RawMoment = { at: number; text: string }

/** One video's hits as the search SQL returns them. */
export type VideoHitRow = {
    id: string
    title: string
    thumbnailUrl: string | null
    duration: number | null
    titleHit: boolean
    chapterHits: number
    chapterMoments: RawMoment[] | null
    speechHits: number
    speechMoments: RawMoment[] | null
    speechRuHits: number
    speechRuMoments: RawMoment[] | null
}

/**
 * Results order: a title hit first, then a chapter hit, then the most speech
 * hits (original and Russian together); ties by title, then id.
 */
export const rankVideoHits = <T extends VideoHitRow>(rows: readonly T[]): T[] =>
    [...rows].sort(
        (a, b) =>
            Number(b.titleHit) - Number(a.titleHit) ||
            Number(b.chapterHits > 0) - Number(a.chapterHits > 0) ||
            b.speechHits + b.speechRuHits - (a.speechHits + a.speechRuHits) ||
            a.title.localeCompare(b.title, 'ru') ||
            a.id.localeCompare(b.id),
    )

export type MomentKind = 'chapter' | 'speech' | 'speechRu'

export type SearchMoment = {
    atSec: number
    kind: MomentKind
    snippet: string
    highlight: Highlight | null
}

/**
 * Up to MAX_MOMENTS_PER_VIDEO moments in time order: chapters first, then
 * what's said, then its Russian translation (a speech moment already shown
 * makes its translation at the same second redundant).
 */
export const pickMoments = (row: VideoHitRow, query: string): SearchMoment[] => {
    const picked: SearchMoment[] = []
    const seenSpeech = new Set<number>()
    const take = (moments: RawMoment[] | null, kind: MomentKind) => {
        for (const m of moments ?? []) {
            if (picked.length >= MAX_MOMENTS_PER_VIDEO) return
            const atSec = Math.max(0, Math.floor(m.at))
            if (kind === 'speechRu' && seenSpeech.has(atSec)) continue
            if (kind === 'speech') seenSpeech.add(atSec)
            picked.push({ atSec, kind, ...buildSnippet(m.text, query) })
        }
    }
    take(row.chapterMoments, 'chapter')
    take(row.speechMoments, 'speech')
    take(row.speechRuMoments, 'speechRu')
    return picked.sort((a, b) => a.atSec - b.atSec)
}
