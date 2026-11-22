import type { PrismaClient } from '@clubspace/prisma-client'

// Automatic chapters from technique titles burned into the picture: the
// lower-third captions instructionals show at the start of each technique
// («SLX Toe Hold»). The worker reads frames with OCR (chapter-ocr.ts); this
// module decides which of the text it found are titles and where they start.
// Side-effect free like thumbnail.ts — frames and the database come in as
// arguments.
//
// Two passes. The coarse pass reads a frame every few seconds of the whole
// video and keeps text that looks like a title. The refine pass re-reads a
// short window around each one densely, which finds the moment it appears and
// a clean reading, and throws out text that flashed by in a single frame.

/** Seconds between frames of the coarse pass over the whole video. */
export const COARSE_STEP_SEC = 3
/** Seconds between frames of the refine pass around each title. */
export const DENSE_STEP_SEC = 0.5
/** Frames are scaled to this width before OCR. */
export const FRAME_WIDTH = 960

// Lines read below this are noise even for counting what is always on screen.
const OCR_FLOOR = 60
// A title is set in large clean type: below this it is a wall sign, a T-shirt
// or a half-faded caption.
const MIN_CONFIDENCE = 85
// «Review» is the shortest real title seen; shorter reads are logo fragments.
const MIN_LETTERS = 6
// Titles are a few words; legal disclaimers and subtitles run longer.
const MAX_WORDS = 8
// A word on screen in more than this share of the coarse frames is part of
// the set (a wall logo, a watermark), not a title...
const PERSISTENT_FRAME_SHARE = 0.15
// ...as long as that is more than a title's own few frames on a short clip.
const PERSISTENT_MIN_FRAMES = 5
// A lesson's titles and logo come to a few hundred distinct words; past this
// the video is covered in text (subtitles, slides).
const MAX_DISTINCT_TOKENS = 2000
// Fuzzy comparisons (frequent words × all words) past which the text is
// slides or subtitles too, not a logo: 2000 words, 125 of them frequent.
// Bounds the main-thread work to a fraction of a second.
const MAX_TOKEN_COMPARISONS = 250_000
// The two halves of a caption this similar are one text said twice; looser
// than SIMILAR because short words misread by one letter fall below it
// («club» / «clue»: 0.75).
const REPEAT_SIMILAR = 0.7
// A line whose letters are this much persistent words is the logo, including
// the logo read together with its tagline («Samurai Brazilian Jiu Jitsu»).
const PERSISTENT_LETTER_SHARE = 0.25
// Two readings at least this similar are the same text (edit-distance ratio).
const SIMILAR = 0.8
// Lines this close (vertical gap, in line heights) belong together: a
// caption set on two lines, or a logo and its tagline.
const LINE_GAP = 0.8
// Two lines of one caption are set in one size; a smaller line right under
// a title is something else (a stray letter of the picture).
const SAME_SIZE = 0.7
// A reading at least this many characters shorter that matches the start of
// another is that one cut off. Closer lengths are rival misreads of the last
// letters («sankakuh» / «sankaku»), left to a vote.
const TRUNCATED_BY = 3
// Sightings of one text further apart than this are separate appearances.
const MERGE_GAP_SEC = 2 * COARSE_STEP_SEC
// A title stays up for at least a second; one frame is a flash or a misread.
const MIN_DENSE_HITS = 2
// A single caption is not a chapter list.
const MIN_CHAPTERS = 2
// More candidate titles than this is a text-heavy video (burned-in
// subtitles, slides), not chapter titles — and would be costly to refine.
const MAX_TITLES_PER_MINUTE = 2
const MIN_TITLE_BUDGET = 10
// VideoTimestamp.title is VarChar(255), the same cap the server applies.
const TITLE_MAX_LENGTH = 255

export interface OcrLine {
    text: string
    /** 0–100, as Tesseract reports it. */
    confidence: number
    /** Bounding box, in pixels of the scaled frame. */
    top: number
    height: number
}

export interface OcrFrame {
    atSec: number
    lines: OcrLine[]
}

export interface Chapter {
    positionSec: number
    title: string
}

export interface FrameWindow {
    startSec: number
    /** Omitted: to the end of the video. */
    durationSec?: number
    stepSec: number
}

/** Reads the frames of a window, one every `stepSec` from `startSec`. */
export interface FrameSource {
    read(window: FrameWindow): Promise<OcrFrame[]>
}

interface Caption {
    text: string
    /** Lowercase letters and digits, single-spaced: what readings are compared by. */
    key: string
    confidence: number
}

interface Sighting {
    atSec: number
    caption: Caption
}

export interface TitleCandidate {
    firstSec: number
    lastSec: number
    sightings: Sighting[]
}

const tokensOf = (text: string) => text.toLowerCase().match(/\p{L}+/gu) ?? []

const wordCount = (text: string) =>
    text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length

const normalize = (text: string) =>
    text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()

// Collapses whitespace and trims the stray marks OCR reads at a caption's
// edges («‘Brazilian Jiu Jitsu», «Jitsu -»).
const cleanText = (text: string) =>
    text
        .replace(/\s+/g, ' ')
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/[^\p{L}\p{N}?!)]+$/u, '')

/**
 * Whether two strings are the same text read twice: an edit-distance ratio
 * of at least `threshold`. The distance is computed only as far as it
 * matters — a length gap or a row past the allowed edits ends it — which
 * keeps thousands of comparisons (a screen full of words) cheap.
 */
export const alike = (a: string, b: string, threshold = SIMILAR) => {
    if (a === b) return true
    const longest = Math.max(a.length, b.length)
    // Most edits a similar pair can be apart; the exact ratio is checked last.
    const limit = Math.floor(longest * (1 - threshold) + 1e-9)
    if (Math.abs(a.length - b.length) > limit) return false
    let previous = Array.from({ length: b.length + 1 }, (_, idx) => idx)
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i]
        let rowMin = i
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
            rowMin = Math.min(rowMin, current[j])
        }
        if (rowMin > limit) return false
        previous = current
    }
    return 1 - previous[b.length] / longest >= threshold
}

// A banner or print reads as the same words twice: «JIU-JITSU | JIU-JITSU»,
// «CLUB CLUE» (one of the two misread). Titles name a thing once.
const repeatsItself = (key: string) => {
    const words = key.split(' ')
    if (words.length % 2 !== 0) return false
    const half = words.length / 2
    return alike(words.slice(0, half).join(' '), words.slice(half).join(' '), REPEAT_SIMILAR)
}

// Logo fragments are cut-off reads of the same word: «samura», «murai».
const tokensSimilar = (a: string, b: string) => {
    if (alike(a, b)) return true
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
    return shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)
}

// `short` reads as the start of `long`: the caption cut off by a fade-in or
// a misread last word.
const readsAsPrefix = (short: string, long: string) =>
    short.length >= MIN_LETTERS &&
    short.length < long.length &&
    alike(short, long.slice(0, short.length))

/**
 * Whether two caption keys are the same text: similar as a whole, or one a
 * truncated read of the other («elevate ir» of «elevate into inside sankaku»).
 */
export const textsSimilar = (a: string, b: string) =>
    alike(a, b) || readsAsPrefix(a, b) || readsAsPrefix(b, a)

/**
 * Words on screen through much of the video: a wall logo, a watermark. Null
 * when the frames hold more text than titles and a logo ever do — subtitles
 * or slides, which have no title chapters and would cost seconds of blocking
 * comparisons.
 */
export const findPersistentTokens = (frames: OcrFrame[]): string[] | null => {
    const framesByToken = new Map<string, Set<number>>()
    frames.forEach((frame, idx) => {
        for (const line of frame.lines) {
            if (line.confidence < OCR_FLOOR) continue
            for (const token of tokensOf(line.text)) {
                if (token.length < 3) continue
                const seen = framesByToken.get(token) ?? new Set<number>()
                seen.add(idx)
                framesByToken.set(token, seen)
            }
        }
    })
    if (framesByToken.size > MAX_DISTINCT_TOKENS) return null

    const byLength = [...framesByToken.keys()].sort((a, b) => a.length - b.length)
    const framesOf = (token: string) => framesByToken.get(token) as Set<number>
    // Only a word read often on its own can be persistent; its broken reads
    // match it later anyway (tokensSimilar in persistentShare).
    const candidates = byLength.filter((token) => framesOf(token).size >= PERSISTENT_MIN_FRAMES)
    if (candidates.length * byLength.length > MAX_TOKEN_COMPARISONS) return null

    const threshold = frames.length * PERSISTENT_FRAME_SHARE
    return candidates.filter((token) => {
        // Fuzzy: frames that show «SAMURA» or «MURAI» count for «samurai»
        // too. tokensSimilar never matches lengths outside this window.
        const seen = new Set(framesOf(token))
        for (const other of byLength) {
            if (seen.size > threshold) return true
            if (other.length < token.length * 0.6) continue
            if (other.length > token.length / 0.6) break
            if (other === token || !tokensSimilar(token, other)) continue
            for (const idx of framesOf(other)) seen.add(idx)
        }
        return seen.size > threshold
    })
}

const persistentShare = (text: string, persistent: string[]) => {
    let total = 0
    let matched = 0
    for (const token of tokensOf(text)) {
        total += token.length
        if (persistent.some((other) => tokensSimilar(token, other))) matched += token.length
    }
    return total === 0 ? 0 : matched / total
}

// The boxes overlap or sit within LINE_GAP line heights of one another.
const touching = (a: OcrLine, b: OcrLine) =>
    Math.max(a.top, b.top) - Math.min(a.top + a.height, b.top + b.height) <=
    LINE_GAP * Math.max(a.height, b.height)

/**
 * The text of a frame that could be a title. Unsure reads and prose are
 * dropped, and so is the set's logo with whatever is set right against it
 * (its tagline, read alone: «Brazilian Jiu Jitsu»), and text that says the
 * same thing twice (a banner). Lines of the same size right below one
 * another are one caption.
 */
export const captionsOf = (lines: OcrLine[], persistent: string[]): Caption[] => {
    const logo = lines.filter(
        (line) =>
            line.confidence >= OCR_FLOOR &&
            persistentShare(line.text, persistent) >= PERSISTENT_LETTER_SHARE,
    )
    const kept = lines
        .filter(
            (line) =>
                line.confidence >= MIN_CONFIDENCE &&
                wordCount(line.text) <= MAX_WORDS &&
                // A logo line touches itself.
                !logo.some((other) => touching(other, line)),
        )
        .sort((a, b) => a.top - b.top)

    const blocks: OcrLine[][] = []
    for (const line of kept) {
        const block = blocks.at(-1)
        const above = block?.at(-1)
        if (
            block &&
            above &&
            touching(above, line) &&
            Math.min(above.height, line.height) >= SAME_SIZE * Math.max(above.height, line.height)
        ) {
            block.push(line)
        } else {
            blocks.push([line])
        }
    }

    return blocks
        .map((block) => {
            const text = cleanText(block.map((line) => line.text).join(' '))
            return {
                text,
                key: normalize(text),
                confidence: Math.min(...block.map((line) => line.confidence)),
            }
        })
        .filter(
            (caption) =>
                (caption.text.match(/\p{L}/gu)?.length ?? 0) >= MIN_LETTERS &&
                wordCount(caption.text) <= MAX_WORDS &&
                !repeatsItself(caption.key),
        )
}

/**
 * The reading to keep from several frames of one title: the one most frames
 * support — its own reads plus reads of it cut off well short — then the
 * surest, then the longest.
 */
export const bestReading = (sightings: Sighting[]): Caption => {
    const byKey = new Map<string, { caption: Caption; count: number }>()
    for (const { caption } of sightings) {
        const entry = byKey.get(caption.key)
        if (!entry) {
            byKey.set(caption.key, { caption, count: 1 })
            continue
        }
        entry.count += 1
        if (caption.confidence > entry.caption.confidence) entry.caption = caption
    }
    const entries = [...byKey.values()]
    const scored = entries.map((entry) => ({
        caption: entry.caption,
        support: entries.reduce(
            (sum, other) =>
                other === entry ||
                (other.caption.key.length <= entry.caption.key.length - TRUNCATED_BY &&
                    readsAsPrefix(other.caption.key, entry.caption.key))
                    ? sum + other.count
                    : sum,
            0,
        ),
    }))
    const [best] = scored.sort(
        (a, b) =>
            b.support - a.support ||
            b.caption.confidence - a.caption.confidence ||
            b.caption.key.length - a.caption.key.length,
    )
    return best.caption
}

/** Coarse pass: each distinct appearance of title-like text, in order. */
export const findTitleCandidates = (frames: OcrFrame[], persistent: string[]) => {
    const candidates: TitleCandidate[] = []
    const ordered = [...frames].sort((a, b) => a.atSec - b.atSec)
    for (const frame of ordered) {
        for (const caption of captionsOf(frame.lines, persistent)) {
            const open = candidates.find(
                (candidate) =>
                    frame.atSec - candidate.lastSec <= MERGE_GAP_SEC &&
                    candidate.sightings.some((sighting) =>
                        textsSimilar(sighting.caption.key, caption.key),
                    ),
            )
            if (open) {
                open.sightings.push({ atSec: frame.atSec, caption })
                open.lastSec = frame.atSec
            } else {
                candidates.push({
                    firstSec: frame.atSec,
                    lastSec: frame.atSec,
                    sightings: [{ atSec: frame.atSec, caption }],
                })
            }
        }
    }
    return candidates
}

/**
 * The window the refine pass reads around a candidate: from just after the
 * coarse frame before its first sighting to just before the one after its last.
 */
export const refineWindow = (candidate: TitleCandidate): FrameWindow => {
    const startSec = Math.max(0, candidate.firstSec - COARSE_STEP_SEC + DENSE_STEP_SEC)
    const endSec = candidate.lastSec + COARSE_STEP_SEC - DENSE_STEP_SEC
    return { startSec, durationSec: endSec - startSec, stepSec: DENSE_STEP_SEC }
}

/**
 * Refine pass for one candidate: the chapter starts at the first dense frame
 * that shows it, titled with the best reading across those frames. Null when
 * it is visible in fewer than two of them.
 */
export const refineCandidate = (
    candidate: TitleCandidate,
    frames: OcrFrame[],
    persistent: string[],
): Chapter | null => {
    const { key } = bestReading(candidate.sightings)
    const hits: Sighting[] = []
    for (const frame of frames) {
        const caption = captionsOf(frame.lines, persistent).find((c) => textsSimilar(c.key, key))
        if (caption) hits.push({ atSec: frame.atSec, caption })
    }
    if (hits.length < MIN_DENSE_HITS) return null
    return {
        positionSec: Math.floor(Math.min(...hits.map((hit) => hit.atSec))),
        title: bestReading(hits).text.slice(0, TITLE_MAX_LENGTH),
    }
}

/**
 * In order, without a repeat of an earlier title (an overlay that comes back)
 * or a second chapter at the same second; none unless at least two remain.
 */
export const finalizeChapters = (chapters: Chapter[]): Chapter[] => {
    const kept: Chapter[] = []
    for (const chapter of [...chapters].sort((a, b) => a.positionSec - b.positionSec)) {
        const key = normalize(chapter.title)
        const repeat = kept.some(
            (other) =>
                other.positionSec === chapter.positionSec ||
                textsSimilar(normalize(other.title), key),
        )
        if (!repeat) kept.push(chapter)
    }
    return kept.length >= MIN_CHAPTERS ? kept : []
}

export interface ChapterScan {
    chapters: Chapter[]
    /** Title-like texts the coarse pass found, before the refine pass. */
    candidates: number
    coarseFrames: number
    /** Too much text on screen to look for titles in (subtitles, slides). */
    textHeavy?: boolean
}

/** Both passes over a video. */
export const detectChapters = async (source: FrameSource): Promise<ChapterScan> => {
    const coarse = await source.read({ startSec: 0, stepSec: COARSE_STEP_SEC })
    const persistent = findPersistentTokens(coarse)
    if (!persistent) {
        return { chapters: [], candidates: 0, coarseFrames: coarse.length, textHeavy: true }
    }
    const candidates = findTitleCandidates(coarse, persistent)
    const scan = { chapters: [], candidates: candidates.length, coarseFrames: coarse.length }

    const minutes = (coarse.length * COARSE_STEP_SEC) / 60
    const budget = Math.max(MIN_TITLE_BUDGET, Math.ceil(minutes * MAX_TITLES_PER_MINUTE))
    if (candidates.length < MIN_CHAPTERS || candidates.length > budget) return scan

    const chapters: Chapter[] = []
    // One window at a time: each is an ffmpeg decode plus OCR.
    for (const candidate of candidates) {
        const frames = await source.read(refineWindow(candidate))
        const chapter = refineCandidate(candidate, frames, persistent)
        if (chapter) chapters.push(chapter)
    }
    return { ...scan, chapters: finalizeChapters(chapters) }
}

/** VideoTimestamp.source of an automatic chapter: read off the screen or heard. */
export type ChapterSource = 'ocr' | 'speech'

/**
 * Stores the chapters unless the video has some. 'kept': it had chapters (a
 * coach's) or is gone — those are never replaced or mixed with automatic ones.
 */
export const publishChapters = async (
    prisma: Pick<PrismaClient, '$transaction'>,
    videoId: string,
    chapters: Chapter[],
    source: ChapterSource,
): Promise<'created' | 'kept'> =>
    prisma.$transaction(async (tx) => {
        // Locks the video row. A coach's chapter insert takes a key-share lock
        // on it (the foreign key), so the check below cannot interleave with
        // one: it either sees that chapter or the chapter waits for ours.
        const video = await tx.$queryRaw<
            Array<{ id: string }>
        >`SELECT "id" FROM "Video" WHERE "id" = ${videoId}::uuid FOR UPDATE`
        if (video.length === 0) return 'kept'
        if ((await tx.videoTimestamp.count({ where: { videoId } })) > 0) return 'kept'
        await tx.videoTimestamp.createMany({
            data: chapters.map((chapter) => ({
                videoId,
                positionSec: chapter.positionSec,
                title: chapter.title,
                source,
            })),
        })
        return 'created'
    })
