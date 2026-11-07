import type { Chapter } from './chapters.js'

// Chapters from what the instructor says, for videos with no titles on
// screen: a Whisper transcript goes to a language model that names the
// techniques, and its answer is checked here before anything is stored.
// Side-effect free — speech.ts runs Whisper and calls the model.

export interface TranscriptSegment {
    startSec: number
    endSec: number
    text: string
}

export interface Transcript {
    /** Whisper's language code ('en', 'ru'), null when it did not say. */
    language: string | null
    segments: TranscriptSegment[]
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

/** The validated chapters, or why there are none. */
export interface SpeechChapters {
    chapters: Chapter[]
    rejected?: string
}

// Less than this is music with a few words over it, not a lesson.
const MIN_TRANSCRIPT_WORDS = 40
// Chapters closer than this are one technique split in two.
const MIN_GAP_SEC = 20
// A title is a name, not a sentence.
const MAX_TITLE_WORDS = 10
// VideoTimestamp.title is VarChar(255).
const TITLE_MAX_LENGTH = 255
const MIN_CHAPTERS = 2
// Whisper reads at most half its 448-token text context as a prompt; a
// vocabulary list stays well inside that.
const PROMPT_TOKENS = 200
// Sport terms listed for the chat model: the common ones, a few hundred
// tokens at most.
const MAX_VOCABULARY = 80

/** What the model is asked for: a chapter a minute at most, three on a short clip. */
export const maxSpeechChapters = (durationSec: number) =>
    Math.max(3, Math.floor(durationSec / 60))

// What is accepted: a model overshooting its brief a little (7 chapters for a
// dense 6-minute lesson) still splits it sensibly; far more is a chapter per
// sentence.
const acceptedMaxChapters = (durationSec: number) =>
    Math.ceil(maxSpeechChapters(durationSec) * 1.5)

/** 75 → '01:15', 3725 → '1:02:05'. */
export const formatClock = (sec: number) => {
    const whole = Math.floor(sec)
    const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0')
    const ss = String(whole % 60).padStart(2, '0')
    return whole >= 3600 ? `${Math.floor(whole / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Seconds from 75, '75', '01:15', '[1:02:05]' or '01:15.5'; null otherwise. */
export const parseClock = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value !== 'string') return null
    const text = value.trim().replace(/^\[|\]$/g, '')
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?$/.exec(text)
    if (!match) return null
    return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

const wordsOf = (text: string) => text.toLowerCase().match(/\p{L}+/gu) ?? []

/**
 * whisper-cli's `-oj` output. Non-speech markers («[BLANK_AUDIO]», «[Music]»,
 * «(laughs)», «♪») are dropped, and segments left empty with them. So are two
 * kinds of Whisper hallucination over music or silence: a segment repeating
 * the one before word for word (one invented sentence looped for the whole
 * clip), and one made only of words of the `prompt` it was given (the prompt
 * echoed: «5. Octopus»).
 */
export const parseWhisperJson = (json: string, prompt = ''): Transcript => {
    const parsed = JSON.parse(json) as {
        result?: { language?: unknown }
        transcription?: Array<{ offsets?: { from?: unknown; to?: unknown }; text?: unknown }>
    }
    const promptWords = new Set(wordsOf(prompt))
    const segments: TranscriptSegment[] = []
    for (const item of parsed.transcription ?? []) {
        const text = String(item.text ?? '')
            .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        const from = Number(item.offsets?.from)
        const to = Number(item.offsets?.to)
        if (!text || !Number.isFinite(from) || !Number.isFinite(to)) continue
        if (text === segments.at(-1)?.text) continue
        const words = wordsOf(text)
        if (words.length > 0 && words.every((word) => promptWords.has(word))) continue
        segments.push({ startSec: from / 1000, endSec: to / 1000, text })
    }
    const language = parsed.result?.language
    return {
        language: typeof language === 'string' && language !== 'auto' ? language : null,
        segments,
    }
}

/** Enough words to be someone teaching. */
export const hasSpeech = (transcript: Transcript) =>
    transcript.segments.reduce((sum, segment) => sum + segment.text.split(' ').length, 0) >=
    MIN_TRANSCRIPT_WORDS

const languageName = (code: string | null) => {
    if (!code) return null
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? null
    } catch {
        return null
    }
}

/** What the club calls the video: hints for names the recognizer gets wrong. */
export interface ChapterContext {
    videoTitle: string
    /** The courses it is a lesson of, with its lesson title there if set. */
    courses: Array<{ title: string; lessonTitle: string | null }>
}

/** The context as prompt lines: «Video title: …», «Course: … (lesson: …)». */
export const describeVideo = (context: ChapterContext) => [
    `Video title: ${context.videoTitle}`,
    ...context.courses.map(
        (course) =>
            `Course: ${course.title}${course.lessonTitle ? ` (lesson: ${course.lessonTitle})` : ''}`,
    ),
]

const CYRILLIC = /\p{Script=Cyrillic}/u

// Whisper's tokens are about four Latin or two Cyrillic letters, plus the
// separator.
const promptTokens = (term: string) => Math.ceil(term.length / (CYRILLIC.test(term) ? 2 : 4)) + 1

/**
 * Whisper's --prompt: a vocabulary list, so it spells techniques as they are
 * written («Kimura», heard as «Camorra» without). First the words of the
 * video's and courses' titles, then the glossary terms that share a word
 * with them («Octopus» → «Octopus Guard»), until about PROMPT_TOKENS.
 *
 * Only relevant terms, not the sport's whole list: on «Octopus 2.0 · Vol 4 ·
 * часть 3» a prompt of the 45 commonest grappling terms made Whisper write
 * the Kimura as «commuter» — an ordinary word nothing can put right after —
 * while «Octopus, часть, Octopus Guard» got «Kimura». And words only: given
 * a whole title, Whisper wrote «7. Octopus 2.0» over a lesson's real speech.
 */
export const whisperPrompt = (context: ChapterContext, glossaryTerms: readonly string[] = []) => {
    const titles = [
        context.videoTitle,
        ...context.courses.flatMap((course) => [course.title, course.lessonTitle ?? '']),
    ]
    const titleWords = titles.flatMap((title) => title.match(/\p{L}{4,}/gu) ?? [])
    const lowerTitleWords = new Set(titleWords.map((word) => word.toLowerCase()))
    const candidates = [
        ...titleWords,
        ...glossaryTerms.filter(
            (term) =>
                !/\d/.test(term) &&
                term
                    .toLowerCase()
                    .split(/[^\p{L}]+/u)
                    .some((word) => lowerTitleWords.has(word)),
        ),
    ]
    const terms = new Map<string, string>()
    let budget = PROMPT_TOKENS
    for (const term of candidates) {
        if (terms.has(term.toLowerCase())) continue
        budget -= promptTokens(term)
        if (budget < 0) break
        terms.set(term.toLowerCase(), term)
    }
    return [...terms.values()].join(', ')
}

/**
 * The request: rules in the system message, the timed transcript in the user
 * one, with the sport's technique names (`vocabulary`, in the transcript's
 * script) so the model can recognise a name the recognizer turned into an
 * ordinary word — Whisper heard «Kimura grip» as «commuter grip», which no
 * spelling rule may touch.
 */
export const buildChapterPrompt = (
    transcript: Transcript,
    durationSec: number,
    context: ChapterContext,
    vocabulary: readonly string[] = [],
): ChatMessage[] => {
    const language = languageName(transcript.language)
    const max = maxSpeechChapters(durationSec)
    const russian = transcript.language === 'ru'
    const terms = vocabulary
        .filter((term) => CYRILLIC.test(term) === russian)
        .slice(0, MAX_VOCABULARY)
    return [
        {
            role: 'system',
            content: [
                'You split the transcript of an instructional training video (martial arts, fitness, yoga or similar) into chapters, the way the instructor would list what the video teaches.',
                'Rules:',
                '- Start a chapter where the instructor moves on to a new technique, position, drill or concept.',
                '- Each title names that technique, position or concept in 2 to 7 words. Not a sentence, no numbering, no quotes.',
                `- Write the titles in ${language ?? 'the language the instructor speaks'}${language ? ', the language the instructor speaks' : ''}.`,
                // Worded this firmly on purpose: told only to fix "plainly
                // misheard" names, a 7B model kept «Camorra» for «Kimura».
                "- Speech recognition often mishears technique names. The video and course titles are spelled correctly: where the transcript has a word that sounds like a technique named in them, the instructor said that technique — use the title's spelling in your chapter titles. Do not name techniques the instructor does not talk about.",
                ...(terms.length > 0
                    ? [
                          `- Technique names of this sport, spelled right: ${terms.join(', ')}. A word that makes no sense in the sport but sounds like one of these is that technique (a "dark choke" is a Darce choke): name it so.`,
                      ]
                    : []),
                '- The first chapter may be a short introduction.',
                '- "start" must be one of the [mm:ss] timestamps in the transcript.',
                `- Between 2 and ${max} chapters, at least ${MIN_GAP_SEC} seconds apart. If the whole video teaches a single thing, answer with an empty list.`,
                'Answer with JSON only, in this shape: {"chapters":[{"start":"mm:ss","title":"..."}]}',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                ...describeVideo(context),
                `Video length: ${formatClock(durationSec)}`,
                'Transcript:',
                ...transcript.segments.map(
                    (segment) => `[${formatClock(segment.startSec)}] ${segment.text}`,
                ),
            ].join('\n'),
        },
    ]
}

/** The JSON in a model's answer: as is, inside a ```json fence, or between the first bracket and the last. */
export const parseJsonLoosely = (content: string): unknown => {
    const attempts = [
        content,
        /```(?:json)?\s*([\s\S]*?)```/.exec(content)?.[1],
        content.slice(content.search(/[[{]/), Math.max(content.lastIndexOf('}'), content.lastIndexOf(']')) + 1),
    ]
    for (const attempt of attempts) {
        if (!attempt) continue
        try {
            return JSON.parse(attempt)
        } catch {
            // Next shape.
        }
    }
    return undefined
}

/** The list in a parsed answer: the answer itself, `chapters`, or its first array. */
export const itemsOf = (parsed: unknown): unknown[] | null => {
    if (Array.isArray(parsed)) return parsed
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.chapters)) return record.chapters
    return Object.values(record).find(Array.isArray) ?? null
}

const cleanTitle = (value: unknown) =>
    typeof value === 'string'
        ? value
              // Control and format characters: a NUL fails the whole insert,
              // a bidi override garbles the list. Spaces between words stay.
              .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
              // Markdown emphasis and code: **Guard Pass**, `Guard Pass`.
              .replace(/[*`]+|~~|(^|\s)_+|_+(?=\s|$)/g, '$1')
              .replace(/\s+/g, ' ')
              .trim()
              // «1. Guard Pass», «Chapter 2: Guard Pass», quotes.
              .replace(/^(?:(?:chapter|глава)\s*)?\d+\s*[.):-]\s*/i, '')
              .replace(/^["'«“]+|["'»”]+$/g, '')
              .trim()
        : ''

const nearestStart = (segments: TranscriptSegment[], sec: number) =>
    segments.reduce((best, segment) =>
        Math.abs(segment.startSec - sec) < Math.abs(best.startSec - sec) ? segment : best,
    ).startSec

// A model with nothing to go on numbers the parts instead of naming them:
// «Technique 7», «Part 2», «Часть 3».
const PLACEHOLDER_TITLE =
    /^(?:technique|part|chapter|section|segment|step|topic|техника|часть|глава|раздел|шаг|при[её]м)\s*(?:#|№)?\s*\d+$/i

/** The answer was not JSON at all; one corrective follow-up may fix it. */
export const NOT_A_CHAPTER_LIST = 'answer is not a JSON chapter list'

/** The follow-up after an answer that was not JSON: the answer, then the shape again. */
export const retryMessages = (answer: string): ChatMessage[] => [
    { role: 'assistant', content: answer },
    {
        role: 'user',
        content:
            'That is not valid JSON. Answer again with JSON only, nothing else, in exactly this shape: {"chapters":[{"start":"mm:ss","title":"..."}]} — each "start" one of the transcript timestamps, or {"chapters":[]} if the video teaches a single thing.',
    },
]

/**
 * Fewer chapters, by folding the shortest into a neighbour — the shorter of
 * the two around it — until at most `max` remain. The merged chapter starts
 * where the earlier did and keeps the more general title: the one with fewer
 * words, else the one that ran longer.
 */
export const mergeShortest = (chapters: Chapter[], durationSec: number, max: number) => {
    const merged = [...chapters]
    const length = (idx: number) =>
        (idx + 1 < merged.length ? merged[idx + 1].positionSec : durationSec) -
        merged[idx].positionSec
    while (merged.length > Math.max(max, 1)) {
        let shortest = 0
        for (let idx = 1; idx < merged.length; idx += 1) {
            if (length(idx) < length(shortest)) shortest = idx
        }
        const neighbour =
            shortest === 0
                ? 1
                : shortest === merged.length - 1 || length(shortest - 1) <= length(shortest + 1)
                  ? shortest - 1
                  : shortest + 1
        const [first, second] = [Math.min(shortest, neighbour), Math.max(shortest, neighbour)]
        const words = (idx: number) => merged[idx].title.split(' ').length
        const general =
            words(first) !== words(second)
                ? words(first) < words(second)
                    ? first
                    : second
                : length(first) >= length(second)
                  ? first
                  : second
        merged.splice(first, 2, {
            positionSec: merged[first].positionSec,
            title: merged[general].title,
        })
    }
    return merged
}

/**
 * The model's answer as chapters: each start snapped to the transcript
 * segment nearest to it, in order, without repeats, placeholders or starts
 * past the end. A chapter shorter than MIN_GAP_SEC gives way to the one
 * after it (a few seconds of «Introduction» before the first technique); more
 * than acceptedMaxChapters are merged down to it. None unless 2 remain. A
 * JSON object without a list is an empty one.
 */
export const parseChapterAnswer = (
    content: string,
    transcript: Transcript,
    durationSec: number,
): SpeechChapters => {
    const parsed = parseJsonLoosely(content)
    if (!parsed || typeof parsed !== 'object') return { chapters: [], rejected: NOT_A_CHAPTER_LIST }
    if (transcript.segments.length === 0) return { chapters: [], rejected: 'empty transcript' }
    const items = itemsOf(parsed) ?? []

    const proposed: Chapter[] = []
    for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const startSec = parseClock(record.start ?? record.time ?? record.timestamp)
        const title = cleanTitle(record.title ?? record.name)
        if (startSec === null || startSec < 0 || startSec >= durationSec) continue
        if (!title || title.split(' ').length > MAX_TITLE_WORDS) continue
        if (PLACEHOLDER_TITLE.test(title)) continue
        proposed.push({
            positionSec: Math.floor(nearestStart(transcript.segments, startSec)),
            title: title.slice(0, TITLE_MAX_LENGTH),
        })
    }

    const chapters: Chapter[] = []
    for (const chapter of proposed.sort((a, b) => a.positionSec - b.positionSec)) {
        const repeat = chapters.some(
            (other) =>
                other.positionSec === chapter.positionSec ||
                other.title.toLowerCase() === chapter.title.toLowerCase(),
        )
        if (repeat) continue
        const previous = chapters.at(-1)
        if (previous && chapter.positionSec - previous.positionSec < MIN_GAP_SEC) chapters.pop()
        chapters.push(chapter)
    }

    if (chapters.length < MIN_CHAPTERS) {
        return {
            chapters: [],
            rejected: `${chapters.length} usable chapter(s) of ${items.length} proposed`,
        }
    }
    return { chapters: mergeShortest(chapters, durationSec, acceptedMaxChapters(durationSec)) }
}
