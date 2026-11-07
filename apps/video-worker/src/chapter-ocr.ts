import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'

import engData from '@tesseract.js-data/eng'
import { type Block, createScheduler, createWorker, OEM } from 'tesseract.js'

import {
    type ChapterScan,
    detectChapters,
    FRAME_WIDTH,
    type FrameSource,
    type FrameWindow,
    type OcrLine,
} from './chapters.js'

// The frames for chapters.ts: ffmpeg cuts them from the source on disk,
// Tesseract (tesseract.js, WebAssembly — no system binary) reads them.

// The LSTM-only model tesseract.js would otherwise download from its CDN on
// first use, read from the @tesseract.js-data/eng package instead: the worker
// needs no network for it and the image ships it in node_modules.
export const ENG_LANG_PATH = join(dirname(engData.langPath), '4.0.0_best_int')

// Each Tesseract worker is a thread holding its own copy of the model. Two
// read a 20-minute lesson's frames in seconds without crowding a transcode.
const OCR_WORKERS = 2

export interface SampleOptions {
    binary: string
    // Input options placed before `-i`: the probe's whitelists and demuxer.
    inputArgs: string[]
    inputPath: string
    timeoutMs: number
}

/**
 * Writes the window's frames, scaled to FRAME_WIDTH, as JPEGs into
 * `outputDir` and resolves them with the moment each shows, in order.
 */
export const sampleFrames = (
    options: SampleOptions & { outputDir: string; window: FrameWindow },
): Promise<Array<{ atSec: number; path: string }>> =>
    new Promise((resolve, reject) => {
        const { window } = options
        const child = spawn(
            options.binary,
            [
                '-y',
                '-v',
                'error',
                // Input options: seek, then read only the window. Timestamps
                // restart at the seek point, so frame n is startSec + n·step.
                '-ss',
                window.startSec.toFixed(3),
                ...(window.durationSec === undefined
                    ? []
                    : ['-t', window.durationSec.toFixed(3)]),
                ...options.inputArgs,
                '-i',
                options.inputPath,
                '-map',
                '0:v:0',
                '-vf',
                `fps=1/${window.stepSec},scale=${FRAME_WIDTH}:-2`,
                '-q:v',
                '3',
                '-f',
                'image2',
                join(options.outputDir, '%05d.jpg'),
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] },
        )
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
            if (code === 0) {
                fs.readdir(options.outputDir).then((names) => {
                    resolve(
                        names
                            .filter((name) => name.endsWith('.jpg'))
                            .sort()
                            .map((name, idx) => ({
                                atSec: window.startSec + idx * window.stepSec,
                                path: join(options.outputDir, name),
                            })),
                    )
                }, reject)
            } else if (timedOut) {
                reject(new Error(`ffmpeg frames exceeded ${options.timeoutMs}ms and was killed`))
            } else {
                reject(new Error(stderr.trim() || `ffmpeg frames exited with code ${code}`))
            }
        })
    })

/** Tesseract's lines, with any letter in them. */
export const linesOf = (blocks: Block[] | null): OcrLine[] =>
    (blocks ?? [])
        .flatMap((block) => block.paragraphs)
        .flatMap((paragraph) => paragraph.lines)
        .map((line) => ({
            text: line.text.trim(),
            confidence: line.confidence,
            top: line.bbox.y0,
            height: line.bbox.y1 - line.bbox.y0,
        }))
        .filter((line) => /\p{L}/u.test(line.text))

/**
 * Frames of a video file, read by OCR. Holds Tesseract threads until
 * `close()`.
 */
export const openFrameReader = async (
    options: SampleOptions & { workdir: string },
): Promise<FrameSource & { close(): Promise<void> }> => {
    const scheduler = createScheduler()
    try {
        for (let idx = 0; idx < OCR_WORKERS; idx += 1) {
            const worker = await createWorker('eng', OEM.LSTM_ONLY, {
                langPath: ENG_LANG_PATH,
                gzip: true,
                // Not 'write': it would copy the model into the working
                // directory, which the image's user cannot write.
                cacheMethod: 'none',
            })
            scheduler.addWorker(worker)
            // Tesseract prints a line to stderr for every speck it cannot
            // read («Image too small to scale!!»); keep the worker log clean.
            await worker.setParameters({ debug_file: '/dev/null' })
        }
    } catch (error) {
        await scheduler.terminate()
        throw error
    }

    let windows = 0
    return {
        async read(window) {
            const outputDir = join(options.workdir, `frames-${windows}`)
            windows += 1
            await fs.mkdir(outputDir, { recursive: true })
            try {
                const frames = await sampleFrames({ ...options, outputDir, window })
                return await Promise.all(
                    frames.map(async (frame) => {
                        const { data } = await scheduler.addJob(
                            'recognize',
                            frame.path,
                            {},
                            { blocks: true },
                        )
                        return { atSec: frame.atSec, lines: linesOf(data.blocks) }
                    }),
                )
            } finally {
                await fs.rm(outputDir, { recursive: true, force: true })
            }
        },
        close: () => scheduler.terminate(),
    }
}

/** Chapters from the titles burned into a video file. */
export const scanChapters = async (
    options: SampleOptions & { workdir: string },
): Promise<ChapterScan> => {
    const reader = await openFrameReader(options)
    try {
        return await detectChapters(reader)
    } finally {
        await reader.close()
    }
}
