import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'

import type { Chapter } from './chapters.js'
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
    whisperPrompt,
} from './speech-chapters.js'
import { buildTitleReviewPrompt, parseTitleReview } from './title-review.js'

// The chapter steps' outside tools: ffmpeg for the audio, whisper.cpp's CLI
// for the transcript, any OpenAI-compatible chat endpoint (OpenRouter,
// Ollama, …) to name the chapters and to vet titles read off the screen. All
// optional: without the endpoint OCR titles go unreviewed and there is no
// speech step; without Whisper there is no speech step.

// A local 7B model needs a while for an hour of transcript.
const LLM_TIMEOUT_MS = 5 * 60_000

export interface LlmConfig {
    baseUrl: string
    model: string
    apiKey?: string
}

export interface SpeechConfig {
    whisperCliPath: string
    whisperModelPath: string
    llm: LlmConfig
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

/** The speech step's settings, or why it is off. */
export const speechConfigFrom = (env: {
    whisperCliPath: string
    whisperModelPath?: string
    chaptersLlm: { baseUrl?: string; model?: string; apiKey?: string }
}): { config: SpeechConfig } | { disabled: string } => {
    if (!env.whisperModelPath) return { disabled: 'WHISPER_MODEL_PATH is not set' }
    const llm = llmConfigFrom(env.chaptersLlm)
    if (!llm) return { disabled: 'CHAPTERS_LLM_BASE_URL or CHAPTERS_LLM_MODEL is not set' }
    return {
        config: {
            whisperCliPath: env.whisperCliPath,
            whisperModelPath: env.whisperModelPath,
            llm,
        },
    }
}

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
 */
export class LlmUnavailableError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'LlmUnavailableError'
    }
}

/** Asks the model; resolves the message text of its answer. */
export const requestChat = async (
    llm: LlmConfig,
    messages: ChatMessage[],
    fetchImpl: typeof fetch = fetch,
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
            }),
            signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        })
    } catch (error) {
        throw new LlmUnavailableError(
            `chapters LLM unreachable: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 300)
        throw new LlmUnavailableError(`chapters LLM answered HTTP ${response.status}: ${detail}`)
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

export interface SpeechScan extends SpeechChapters {
    language: string | null
    segments: number
}

/** Chapters from what is said in a video file. */
export const scanSpeechChapters = async (options: {
    config: SpeechConfig
    context: ChapterContext
    ffmpegBinary: string
    // Input options placed before `-i`: the probe's whitelists and demuxer.
    inputArgs: string[]
    inputPath: string
    /** The video's length; the transcript's end when unknown. */
    durationSec: number | null
    workdir: string
    timeoutMs: number
    fetchImpl?: typeof fetch
}): Promise<SpeechScan> => {
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
        // The titles' words as a vocabulary hint (see whisperPrompt).
        const prompt = whisperPrompt(options.context)
        await runTool(
            options.config.whisperCliPath,
            [
                '-m',
                options.config.whisperModelPath,
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
        const transcript = parseWhisperJson(
            await fs.readFile(`${outputPrefix}.json`, 'utf8'),
            prompt,
        )
        const scan = { language: transcript.language, segments: transcript.segments.length }
        if (!hasSpeech(transcript)) return { ...scan, chapters: [], rejected: 'no speech' }

        // hasSpeech: there are segments.
        const { segments } = transcript
        const durationSec = options.durationSec ?? segments[segments.length - 1].endSec
        const messages = buildChapterPrompt(transcript, durationSec, options.context)
        const answer = await requestChat(options.config.llm, messages, options.fetchImpl)
        const result = parseChapterAnswer(answer, transcript, durationSec)
        if (result.rejected !== NOT_A_CHAPTER_LIST) return { ...scan, ...result }
        // Not JSON at all: once more, with the shape spelled out.
        const retry = await requestChat(
            options.config.llm,
            [...messages, ...retryMessages(answer)],
            options.fetchImpl,
        )
        return { ...scan, ...parseChapterAnswer(retry, transcript, durationSec) }
    } finally {
        await fs.rm(wavPath, { force: true })
        await fs.rm(`${outputPrefix}.json`, { force: true })
    }
}
