import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { setTimeout as pause } from 'timers/promises'

import type { Chapter } from './chapters.js'
import type { RussianTerm } from '@clubspace/sport-glossary'
import {
    buildChapterPrompt,
    type ChapterContext,
    type ChatMessage,
    hasSpeech,
    NOT_A_CHAPTER_LIST,
    parseChapterAnswer,
    parseWhisperJson,
    retryMessages,
    type SpeechChapters,
    type Transcript,
    whisperPrompt,
} from './speech-chapters.js'
import {
    buildTranslationPrompt,
    type Cue,
    fixTerminology,
    parseTranslation,
    type Phrase,
    termsIn,
    TRANSLATION_BATCH,
    translatedCues,
    translationRetryMessages,
    unitsOf,
} from './subtitles.js'
import { type Glossary, type Snap, snapTerms } from './term-snap.js'
import { buildTitleReviewPrompt, parseTitleReview } from './title-review.js'

// The outside tools of the chapter and subtitle steps: ffmpeg for the audio,
// whisper.cpp's CLI for the transcript, any OpenAI-compatible chat endpoint
// (OpenRouter, Ollama, …) to name chapters, vet titles read off the screen and
// translate subtitles. All optional: without Whisper there is no transcript
// (so no subtitles and no speech chapters); without the endpoint OCR titles go
// unreviewed, there are no speech chapters and no translation.

// A local 7B model needs a while for an hour of transcript.
const LLM_TIMEOUT_MS = 5 * 60_000

export interface LlmConfig {
    baseUrl: string
    model: string
    apiKey?: string
}

export interface WhisperConfig {
    cliPath: string
    modelPath: string
}

/** The chat endpoint, when both its URL and model are set. */
export const llmConfigFrom = (env: {
    baseUrl?: string
    model?: string
    apiKey?: string
}): LlmConfig | null =>
    env.baseUrl && env.model
        ? { baseUrl: env.baseUrl, model: env.model, ...(env.apiKey && { apiKey: env.apiKey }) }
        : null

/** Whisper, when a model is set. */
export const whisperConfigFrom = (env: {
    whisperCliPath: string
    whisperModelPath?: string
}): WhisperConfig | null =>
    env.whisperModelPath ? { cliPath: env.whisperCliPath, modelPath: env.whisperModelPath } : null

/** Runs a tool to completion; rejects with the end of its stderr. */
export const runTool = (
    binary: string,
    args: string[],
    options: { label: string; timeoutMs: number },
): Promise<void> =>
    new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = (stderr + chunk.toString()).slice(-2000)
        })
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
        }, options.timeoutMs)
        child.on('error', (err: Error) => {
            clearTimeout(timer)
            reject(err)
        })
        child.on('close', (code: number | null) => {
            clearTimeout(timer)
            if (code === 0) resolve()
            else if (timedOut) {
                reject(new Error(`${options.label} exceeded ${options.timeoutMs}ms and was killed`))
            } else {
                reject(new Error(stderr.trim() || `${options.label} exited with code ${code}`))
            }
        })
    })

/**
 * The model could not be asked: unreachable, timed out, or it refused (HTTP
 * 402 when the account is out of credits, 401, 429, 5xx). An operational
 * state of the endpoint rather than of the video — callers warn instead of
 * reporting each video, and the backfill retries once it is back.
 * `transient`: worth asking again in a while (unreachable, timed out — a
 * local Ollama busy with another request — 429 or 5xx), unlike a refusal.
 */
export class LlmUnavailableError extends Error {
    constructor(
        message: string,
        readonly transient: boolean,
    ) {
        super(message)
        this.name = 'LlmUnavailableError'
    }
}

/**
 * Asks the model; resolves the message text of its answer. `maxTokens` caps
 * the answer: a small model sometimes repeats itself without end, and an
 * uncapped answer then runs until the timeout.
 */
export const requestChat = async (
    llm: LlmConfig,
    messages: ChatMessage[],
    fetchImpl: typeof fetch = fetch,
    timeoutMs = LLM_TIMEOUT_MS,
    maxTokens?: number,
): Promise<string> => {
    let response: Response
    try {
        response = await fetchImpl(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(llm.apiKey && { Authorization: `Bearer ${llm.apiKey}` }),
            },
            body: JSON.stringify({
                model: llm.model,
                messages,
                // The same transcript should give the same chapters on a re-run.
                temperature: 0,
                response_format: { type: 'json_object' },
                ...(maxTokens !== undefined && { max_tokens: maxTokens }),
            }),
            signal: AbortSignal.timeout(timeoutMs),
        })
    } catch (error) {
        throw new LlmUnavailableError(
            `chapters LLM unreachable: ${error instanceof Error ? error.message : String(error)}`,
            true,
        )
    }
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 300)
        throw new LlmUnavailableError(
            `chapters LLM answered HTTP ${response.status}: ${detail}`,
            response.status === 429 || response.status >= 500,
        )
    }
    const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('chapters LLM answer has no message text')
    return content
}

/** The OCR titles the model takes for chapter titles (title-review.ts). */
export const reviewTitles = async (
    llm: LlmConfig,
    context: ChapterContext,
    chapters: Chapter[],
    fetchImpl?: typeof fetch,
): Promise<Chapter[]> =>
    parseTitleReview(
        await requestChat(llm, buildTitleReviewPrompt(context, chapters), fetchImpl),
        chapters,
    )

/** What Whisper heard, technique names snapped to the glossary. */
export interface Heard {
    transcript: Transcript
    snaps: Snap[]
}

/** The transcript of a video file's first audio stream. */
export const transcribeVideo = async (options: {
    whisper: WhisperConfig
    context: ChapterContext
    glossary: Glossary
    ffmpegBinary: string
    // Input options placed before `-i`: the probe's whitelists and demuxer.
    inputArgs: string[]
    inputPath: string
    workdir: string
    timeoutMs: number
}): Promise<Heard> => {
    const wavPath = join(options.workdir, 'speech.wav')
    const outputPrefix = join(options.workdir, 'speech')
    try {
        // 16 kHz mono PCM: the only input whisper.cpp takes.
        await runTool(
            options.ffmpegBinary,
            [
                '-y',
                '-v',
                'error',
                ...options.inputArgs,
                '-i',
                options.inputPath,
                '-map',
                '0:a:0',
                '-vn',
                '-ac',
                '1',
                '-ar',
                '16000',
                '-c:a',
                'pcm_s16le',
                wavPath,
            ],
            { label: 'ffmpeg audio', timeoutMs: options.timeoutMs },
        )
        // A vocabulary hint (see whisperPrompt).
        const prompt = whisperPrompt(
            options.context,
            options.glossary.terms.map((term) => term.canonical),
        )
        await runTool(
            options.whisper.cliPath,
            [
                '-m',
                options.whisper.modelPath,
                '-f',
                wavPath,
                '-l',
                'auto',
                // Drops tokens like «[Music]» before they reach the text.
                '--suppress-nst',
                '-oj',
                '-of',
                outputPrefix,
                '-np',
                ...(prompt ? ['--prompt', prompt] : []),
            ],
            { label: 'whisper-cli', timeoutMs: options.timeoutMs },
        )
        const heard = parseWhisperJson(await fs.readFile(`${outputPrefix}.json`, 'utf8'), prompt)
        // Technique names put right before anyone reads them.
        const snaps: Snap[] = []
        const segments = heard.segments.map((segment) => {
            const snapped = snapTerms(segment.text, options.glossary)
            snaps.push(...snapped.snaps)
            return { ...segment, text: snapped.text }
        })
        return { transcript: { ...heard, segments }, snaps }
    } finally {
        await fs.rm(wavPath, { force: true })
        await fs.rm(`${outputPrefix}.json`, { force: true })
    }
}

export interface SpeechChapterScan extends SpeechChapters {
    /** Misheard terms put right in the titles. */
    snaps: Snap[]
}

/** Chapters named by the chat model from a transcript. */
export const chaptersFromTranscript = async (options: {
    llm: LlmConfig
    transcript: Transcript
    context: ChapterContext
    glossary: Glossary
    /** The video's length; the transcript's end when unknown. */
    durationSec: number | null
    fetchImpl?: typeof fetch
}): Promise<SpeechChapterScan> => {
    const { transcript } = options
    if (!hasSpeech(transcript)) return { chapters: [], rejected: 'no speech', snaps: [] }

    // hasSpeech: there are segments.
    const { segments } = transcript
    const durationSec = options.durationSec ?? segments[segments.length - 1].endSec
    const messages = buildChapterPrompt(
        transcript,
        durationSec,
        options.context,
        options.glossary.sportTerms,
    )
    const answer = await requestChat(options.llm, messages, options.fetchImpl)
    let result = parseChapterAnswer(answer, transcript, durationSec)
    if (result.rejected === NOT_A_CHAPTER_LIST) {
        // Not JSON at all: once more, with the shape spelled out.
        const retry = await requestChat(
            options.llm,
            [...messages, ...retryMessages(answer)],
            options.fetchImpl,
        )
        result = parseChapterAnswer(retry, transcript, durationSec)
    }
    const snaps: Snap[] = []
    const chapters = result.chapters.map((chapter) => {
        const snapped = snapTerms(chapter.title, options.glossary)
        snaps.push(...snapped.snaps)
        return { ...chapter, title: snapped.text }
    })
    return { ...result, chapters, snaps }
}

// What a batch's answer left out is asked for again in lists this short — a
// local model that drops phrases from fifteen keeps all of three — for this
// many rounds, then once more one phrase at a time.
const RETRY_BATCH = 3
const RETRY_ROUNDS = 2
// A busy local model times out now and then: the same request is asked again
// after these pauses before the whole track gives up.
const BUSY_RETRY_DELAYS_MS = [10_000, 30_000]
// Phrases the model never translated stay in the original language, as long
// as they are this small a share; above it the track is worse than none.
const MAX_UNTRANSLATED_SHARE = 0.2
// A batch is at most fifteen phrases of up to 300 characters; its Russian
// fits in this many tokens with room to spare. An answer that runs past it is
// the model repeating itself: cut there, it parses as nothing and the batch's
// phrases are asked for again in shorter lists. Without the cap such an
// answer ran into the timeout three times and lost the whole track.
const TRANSLATION_MAX_TOKENS = 4096
const TRANSLATION_TIMEOUT_MS = 3 * 60_000

/**
 * The cues in Russian. Whole phrases are translated (unitsOf), in batches
 * the model answers by id, and each phrase's translation is spread over its
 * own cues, keeping their times. Each request lists the sport's terms its
 * phrases say, and the answers' mistranslated terms are put right
 * (fixTerminology). An answer that is no usable JSON is asked again once
 * with the shape spelled out; phrases an answer leaves out are asked for
 * again in short lists, then singly. A request that fails because the model
 * is busy or briefly unreachable is repeated after a pause. Phrases still
 * missing keep their original text when they are at most a fifth of the
 * lesson; otherwise null: a track that is mostly holes is worse than none.
 */
export const translateCues = async (options: {
    llm: LlmConfig
    context: ChapterContext
    cues: readonly Cue[]
    terms: readonly RussianTerm[]
    fetchImpl?: typeof fetch
    sleep?: (ms: number) => Promise<void>
}): Promise<Cue[] | null> => {
    const sleep = options.sleep ?? pause
    const chat = async (messages: ChatMessage[]): Promise<string> => {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await requestChat(
                    options.llm,
                    messages,
                    options.fetchImpl,
                    TRANSLATION_TIMEOUT_MS,
                    TRANSLATION_MAX_TOKENS,
                )
            } catch (error) {
                const delay = BUSY_RETRY_DELAYS_MS[attempt]
                if (!(error instanceof LlmUnavailableError && error.transient) || delay === undefined) {
                    throw error
                }
                await sleep(delay)
            }
        }
    }
    const prompt = (phrases: readonly Phrase[]) =>
        buildTranslationPrompt(
            options.context,
            phrases,
            termsIn(phrases.map((phrase) => phrase.text).join('\n'), options.terms),
        )
    const ask = async (messages: ChatMessage[]) => parseTranslation(await chat(messages))
    const askFor = async (phrases: readonly Phrase[], size: number, texts: Map<number, string>) => {
        for (let at = 0; at < phrases.length; at += size) {
            for (const [id, text] of await ask(prompt(phrases.slice(at, at + size)))) {
                texts.set(id, text)
            }
        }
    }
    const phrases = unitsOf(options.cues)
    const translations = new Map<number, string>()
    let untranslated = 0
    for (let from = 0; from < phrases.length; from += TRANSLATION_BATCH) {
        const batch = phrases.slice(from, from + TRANSLATION_BATCH)
        const messages = prompt(batch)
        const answer = await chat(messages)
        let texts = parseTranslation(answer)
        if (texts.size === 0) texts = await ask([...messages, ...translationRetryMessages(answer)])
        const missing = () => batch.filter((phrase) => !texts.has(phrase.id))
        for (let round = 0; round < RETRY_ROUNDS; round += 1) {
            await askFor(missing(), RETRY_BATCH, texts)
        }
        await askFor(missing(), 1, texts)
        for (const phrase of batch) {
            const text = texts.get(phrase.id)
            if (text === undefined) {
                untranslated += 1
                translations.set(phrase.id, phrase.text)
            } else {
                translations.set(phrase.id, fixTerminology(phrase.text, text, options.terms))
            }
        }
    }
    if (untranslated > phrases.length * MAX_UNTRANSLATED_SHARE) return null
    return translatedCues(options.cues, translations)
}
