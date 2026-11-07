import { randomUUID } from 'crypto'

import type { PrismaClient } from '@clubspace/prisma-client'

import type { RussianTerm } from '@clubspace/sport-glossary'
import {
    type ChapterContext,
    type ChatMessage,
    describeVideo,
    itemsOf,
    parseJsonLoosely,
    type TranscriptSegment,
} from './speech-chapters.js'

// Automatic subtitles from a video's transcript: WebVTT cues in the spoken
// language, and a Russian translation of them made by the chat model, so
// Russian-speaking members can follow an English instructional. Stored as
// VideoSubtitle rows with source 'auto', beside — never over — the tracks
// staff upload. Side-effect free like thumbnail.ts: storage and the database
// come in as arguments; speech.ts sends the translation requests.

export interface Cue {
    /**
     * The sentence (segments up to one ending a sentence, at most
     * UNIT_CHARS) the cue is part of: what is translated, so the model never
     * sees half a sentence.
     */
    unit: number
    startSec: number
    endSec: number
    /** One line; wrapped when written. */
    text: string
}

// Readable subtitles: two lines of at most 42 characters, on screen at most
// about 6 seconds unless that would leave fewer than 5 words to a cue; a
// segment shorter than a second or 3 words joins the one before it.
const LINE_CHARS = 42
const CUE_CHARS = 2 * LINE_CHARS
const CUE_SECONDS = 6
const MIN_CUE_WORDS = 5
const TINY_SECONDS = 1
const TINY_WORDS = 3
const JOIN_GAP_SECONDS = 1
// Whisper often cuts its segments mid-sentence; segments are joined into one
// translation unit up to a sentence's end, or this many characters.
const UNIT_CHARS = 300
/**
 * Sentences per translation request. A local 7B model keeps ids reliably at
 * this size; given 40 short cues it dropped the last one, and given pieces
 * cut mid-sentence it merged them and shifted every later translation.
 */
export const TRANSLATION_BATCH = 15

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean)

/** Text that cannot break a cue: no arrows, no tags. */
const cueText = (text: string) =>
    text
        .replace(/-->/g, '→')
        .replace(/[<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

// A segment's words in runs of about `count` equal parts, each fitting in
// two subtitle lines (a single overlong word stands alone).
const splitWords = (words: string[], count: number) => {
    const target = words.join(' ').length / count
    const runs: string[][] = [[]]
    for (const word of words) {
        const run = runs[runs.length - 1]
        const text = run.join(' ')
        if (run.length > 0 && (wrapLines(`${text} ${word}`).length > 2 || text.length >= target)) {
            runs.push([word])
        } else {
            run.push(word)
        }
    }
    return runs.map((run) => run.join(' '))
}

/**
 * Cues from transcript segments. Tiny segments join the one before; a long
 * one is cut into runs of words, each timed by its share of the letters.
 */
export const buildCues = (segments: readonly TranscriptSegment[]): Cue[] => {
    const merged: TranscriptSegment[] = []
    for (const segment of segments) {
        const text = cueText(segment.text)
        if (!text) continue
        const previous = merged[merged.length - 1]
        const tiny =
            segment.endSec - segment.startSec < TINY_SECONDS || wordsOf(text).length < TINY_WORDS
        if (
            previous &&
            tiny &&
            segment.startSec - previous.endSec <= JOIN_GAP_SECONDS &&
            previous.text.length + 1 + text.length <= CUE_CHARS
        ) {
            previous.endSec = segment.endSec
            previous.text = `${previous.text} ${text}`
        } else {
            merged.push({ startSec: segment.startSec, endSec: segment.endSec, text })
        }
    }

    const cues: Cue[] = []
    let unit = 0
    let unitLength = 0
    merged.forEach((segment, idx) => {
        const previous = merged[idx - 1]
        if (previous && (/[.!?…]["»')]*$/.test(previous.text) || unitLength >= UNIT_CHARS)) {
            unit += 1
            unitLength = 0
        }
        unitLength += segment.text.length
        const words = wordsOf(segment.text)
        const count = Math.max(
            Math.ceil(segment.text.length / CUE_CHARS),
            Math.min(
                Math.ceil((segment.endSec - segment.startSec) / CUE_SECONDS),
                Math.floor(words.length / MIN_CUE_WORDS),
            ),
            1,
        )
        cues.push(...timedRuns(segment, unit, splitWords(words, count)))
    })
    return cues
}

// Cues for the runs of a phrase, each timed by its share of the letters.
const timedRuns = (segment: TranscriptSegment, unit: number, runs: readonly string[]): Cue[] => {
    const duration = Math.max(0, segment.endSec - segment.startSec)
    const letters = runs.reduce((sum, run) => sum + run.length, 0)
    let startSec = segment.startSec
    return runs.map((text) => {
        const endSec = startSec + (duration * text.length) / letters
        const cue = { unit, startSec, endSec, text }
        startSec = endSec
        return cue
    })
}

/** A phrase sent for translation: a unit's text, by unit id. */
export interface Phrase {
    id: number
    text: string
}

/** The phrases to translate: each unit's cues joined. */
export const unitsOf = (cues: readonly Cue[]): Phrase[] => {
    const units = new Map<number, string>()
    for (const cue of cues) {
        const text = units.get(cue.unit)
        units.set(cue.unit, text === undefined ? cue.text : `${text} ${cue.text}`)
    }
    return [...units].map(([id, text]) => ({ id, text }))
}

/**
 * The cues in another language: each phrase's translation spread over the
 * phrase's own cues — same times — by their share of its letters.
 */
export const translatedCues = (cues: readonly Cue[], translations: ReadonlyMap<number, string>) => {
    const byUnit = new Map<number, Cue[]>()
    for (const cue of cues) byUnit.set(cue.unit, [...(byUnit.get(cue.unit) ?? []), cue])
    const result: Cue[] = []
    for (const [unit, unitCues] of byUnit) {
        // A phrase left untranslated shows nothing rather than another's text.
        const words = wordsOf(translations.get(unit) ?? '')
        const total = unitCues.reduce((sum, cue) => sum + cue.text.length, 0)
        // Word i goes to the cue whose share of the letters it falls in.
        const texts = unitCues.map(() => [] as string[])
        let before = 0
        const bounds = unitCues.map((cue) => (before += cue.text.length) / total)
        words.forEach((word, idx) => {
            const at = (idx + 0.5) / words.length
            texts[bounds.findIndex((bound) => at <= bound)].push(word)
        })
        unitCues.forEach((cue, idx) => {
            if (texts[idx].length > 0) result.push({ ...cue, text: texts[idx].join(' ') })
        })
    }
    return result
}

/**
 * Lines of at most LINE_CHARS: two balanced lines when the text fits in two,
 * otherwise as many as it takes (a translation may run longer than its cue).
 */
export const wrapLines = (text: string) => {
    if (text.length <= LINE_CHARS) return [text]
    const words = wordsOf(text)
    if (text.length <= CUE_CHARS) {
        // The break nearest the middle that keeps both lines short enough.
        let best: string[] | null = null
        for (let idx = 1; idx < words.length; idx += 1) {
            const first = words.slice(0, idx).join(' ')
            const second = words.slice(idx).join(' ')
            if (first.length > LINE_CHARS || second.length > LINE_CHARS) continue
            if (!best || Math.abs(first.length - second.length) < Math.abs(best[0].length - best[1].length)) {
                best = [first, second]
            }
        }
        if (best) return best
    }
    const lines: string[] = []
    for (const word of words) {
        const last = lines[lines.length - 1]
        if (last !== undefined && last.length + 1 + word.length <= LINE_CHARS) {
            lines[lines.length - 1] = `${last} ${word}`
        } else {
            lines.push(word)
        }
    }
    return lines
}

/** 75.5 → «00:01:15.500». */
export const vttTime = (sec: number) => {
    const ms = Math.round(Math.max(0, sec) * 1000)
    const pad = (value: number, width = 2) => String(value).padStart(width, '0')
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`
}

/** A WebVTT file of the cues, numbered, each wrapped to subtitle lines. */
export const toVtt = (cues: readonly Cue[]) =>
    [
        'WEBVTT',
        ...cues.map(
            (cue, idx) =>
                `${idx + 1}\n${vttTime(cue.startSec)} --> ${vttTime(cue.endSec)}\n${wrapLines(cueText(cue.text)).join('\n')}`,
        ),
    ].join('\n\n') + '\n'

// Bounds of a term: no letter or digit right before or after it.
const TERM_START = '(?<![\\p{L}\\p{N}])'
const TERM_END = '(?![\\p{L}\\p{N}])'
// What `*` in a term's wrong forms stands for: a Russian case ending, or none.
const CASE_ENDING =
    '(а|я|у|ю|ом|ем|ём|ой|ей|е|и|ы|ов|ев|ам|ям|ами|ями|ах|ях|ь|ый|ий|ая|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ую|ых|их|ыми|ими)?'
// Endings carried over to a one-word term ending in a consonant: those after
// a preposition («в защите» → «в гарде», «с осьминогом» → «с октопусом»),
// whatever the gender of the word replaced. Any other gives the nominative.
const CARRIED_ENDINGS: Readonly<Record<string, string>> = {
    ом: 'ом',
    ем: 'ом',
    ой: 'ом',
    ей: 'ом',
    е: 'е',
    ах: 'ах',
    ях: 'ах',
    ами: 'ами',
    ями: 'ами',
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** An English term in any case, its words apart by spaces or hyphens. */
const englishTerm = (en: string, flags = 'iu') =>
    new RegExp(
        `${TERM_START}${en.trim().split(/[\s-]+/).map(escapeRegExp).join('[\\s-]+')}${TERM_END}`,
        flags,
    )

/** The sport's terms the English text says. */
export const termsIn = (text: string, terms: readonly RussianTerm[]) =>
    terms.filter((term) => englishTerm(term.en).test(text))

/**
 * The translation with the sport's terms said as members say them: where the
 * English says a term, its known mistranslations («крестный захват» for
 * «crossface») and the term left in Latin letters become the Russian form.
 * Longer forms first, so «закрытой защите» is one replacement, not two.
 */
export const fixTerminology = (
    source: string,
    translation: string,
    terms: readonly RussianTerm[],
) => {
    const forms = termsIn(source, terms)
        .flatMap((term) => [
            ...(term.wrong ?? []).map((wrong) => ({
                term,
                form: wrong,
                pattern: new RegExp(
                    `${TERM_START}${wrong
                        .split(/\s+/)
                        .map((word) => word.split('*').map(escapeRegExp).join(CASE_ENDING))
                        .join('\\s+')}${TERM_END}`,
                    'giu',
                ),
            })),
            ...(term.en.toLowerCase() === term.ru.toLowerCase()
                ? []
                : [{ term, form: term.en, pattern: englishTerm(term.en, 'giu') }]),
        ])
        .sort((a, b) => b.form.length - a.form.length)
    let text = translation
    for (const { term, form, pattern } of forms) {
        const stars = form.split('*').length - 1
        text = text.replace(pattern, (match: string, ...captures: unknown[]) => {
            const ending = form.endsWith('*') ? ((captures[stars - 1] as string | undefined) ?? '') : ''
            const carried =
                !/\s/.test(term.ru) && /[бвгджзклмнпрстфхцчшщ]$/i.test(term.ru)
                    ? (CARRIED_ENDINGS[ending.toLowerCase()] ?? '')
                    : ''
            const russian = term.ru + carried
            return /^\p{Lu}/u.test(match) ? russian.charAt(0).toUpperCase() + russian.slice(1) : russian
        })
    }
    return text
}

/**
 * The request for one batch: cues by id in, the same ids in Russian out,
 * with the sport's terms the batch says and how members say them.
 */
export const buildTranslationPrompt = (
    context: ChapterContext,
    batch: readonly Phrase[],
    terms: readonly RussianTerm[],
): ChatMessage[] => [
    {
        role: 'system',
        content: [
            'You translate the subtitles of an instructional training video (martial arts, fitness, yoga or similar) into Russian.',
            'Rules:',
            '- Natural, spoken Russian, as a Russian-speaking coach would say it; short enough to read on screen.',
            '- Say the terms of the sport the way Russian-speaking athletes do: exactly as the terminology list gives them, declined as the sentence needs — never a word-for-word translation.',
            '- A name of a technique, position or move that is not in the list stays the way the instructor says it, in Latin letters (Estima lock, Kiss of the Dragon).',
            '- Translate every phrase on its own, keeping its meaning. Add nothing, drop nothing, no notes.',
            'Answer with JSON only, in this shape: {"cues":[{"id":1,"text":"..."}]} — every id you were given, once.',
        ].join('\n'),
    },
    {
        role: 'user',
        content: [
            ...describeVideo(context),
            ...(terms.length > 0
                ? [`Terminology (English → Russian): ${terms.map((term) => `${term.en} → ${term.ru}`).join('; ')}`]
                : []),
            // Counted out: a local model otherwise tends to drop the last one.
            `${batch.length} phrases (ids ${batch.map((phrase) => phrase.id).join(', ')}); answer with all ${batch.length}:`,
            JSON.stringify({ cues: batch }),
        ].join('\n'),
    },
]

/** The follow-up after an unusable answer: the answer, then the shape again. */
export const translationRetryMessages = (answer: string): ChatMessage[] => [
    { role: 'assistant', content: answer },
    {
        role: 'user',
        content:
            'That answer is not usable. Answer again with JSON only, in exactly this shape: {"cues":[{"id":1,"text":"..."}]} — one entry for every id you were given, the text in Russian.',
    },
]

/** The translations by cue id that the answer has — maybe not all of them. */
export const parseTranslation = (content: string): Map<number, string> => {
    const translated = new Map<number, string>()
    for (const item of itemsOf(parseJsonLoosely(content)) ?? []) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const text = typeof record.text === 'string' ? cueText(record.text) : ''
        const id = Number(record.id)
        if (text && Number.isInteger(id)) translated.set(id, text)
    }
    return translated
}

/** «English (авто)», «Русский (авто)»: the language's own name. */
export const autoSubtitleLabel = (language: string) => {
    let name = language
    try {
        name = new Intl.DisplayNames([language], { type: 'language' }).of(language) ?? language
    } catch {
        // Not a language code Intl knows: the code itself.
    }
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} (авто)`.slice(0, 64)
}

// Same shape as the server's buildSubtitleKey (shared/utils/storage-keys):
// under subtitles/, the anonymously readable prefix, and accepted by its
// isSubtitleKey, so an automatic track is served and deleted like an uploaded
// one.
export const buildSubtitleKey = (videoId: string, language: string) =>
    `subtitles/${videoId}/${language}/${randomUUID()}.vtt`

export interface SubtitleStore {
    upload(key: string, body: string): Promise<void>
    publicUrl(key: string): string
}

export interface AutoTrack {
    language: string
    vtt: string
    /** Make it the video's default track when it has none yet. */
    defaultIfNone: boolean
}

/**
 * Uploads the track and stores it as the video's automatic subtitle for its
 * language. 'kept': staff uploaded one for that language (now or meanwhile),
 * which is never replaced. A replaced automatic track's file stays behind —
 * the worker's storage account may write under subtitles/ but not delete
 * there, where staff's files live too.
 */
export const publishAutoSubtitle = async (
    prisma: Pick<PrismaClient, 'videoSubtitle'>,
    store: SubtitleStore,
    videoId: string,
    track: AutoTrack,
): Promise<'created' | 'replaced' | 'kept'> => {
    const where = { videoId_language: { videoId, language: track.language } }
    const existing = await prisma.videoSubtitle.findUnique({
        where,
        select: { id: true, source: true },
    })
    if (existing && existing.source !== 'auto') return 'kept'

    const key = buildSubtitleKey(videoId, track.language)
    await store.upload(key, track.vtt)
    const file = {
        label: autoSubtitleLabel(track.language),
        storageKey: key,
        publicUrl: store.publicUrl(key),
    }
    if (existing) {
        // Only while it is still automatic: staff may have replaced it since.
        const { count } = await prisma.videoSubtitle.updateMany({
            where: { id: existing.id, source: 'auto' },
            data: file,
        })
        return count > 0 ? 'replaced' : 'kept'
    }
    const isDefault =
        track.defaultIfNone &&
        (await prisma.videoSubtitle.count({ where: { videoId, isDefault: true } })) === 0
    try {
        await prisma.videoSubtitle.create({
            data: { videoId, language: track.language, source: 'auto', isDefault, ...file },
        })
        return 'created'
    } catch (error) {
        // Staff uploaded a track for this language a moment ago (unique
        // videoId + language): theirs stays.
        if (error instanceof Object && 'code' in error && error.code === 'P2002') return 'kept'
        throw error
    }
}
