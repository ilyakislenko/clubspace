import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'

import type { PrismaClient } from '@clubspace/prisma-client'

// Auto-generated covers: one JPEG frame per video, made after the transcode
// (and by scripts/backfill-thumbnails.ts for videos from before), so lesson
// lists stop showing «Нет превью». Side-effect free like probe.ts — the S3
// upload and the database come in as arguments.

// Wide enough for a tablet's lesson card, small enough (~50 KB) for a phone
// list on cellular. Narrower sources are not upscaled.
export const THUMBNAIL_WIDTH = 640

// Instructionals open on a black fade, a title card or the coach walking
// into frame. A tenth of the way in is usually the technique itself; the
// clamp keeps a short clip clear of its first seconds and a two-hour seminar
// from seeking deep into the file for no better picture.
const EARLIEST_SEC = 3
const LATEST_SEC = 60

const EXTRACT_TIMEOUT_MS = 60_000

/** The moment of the video the cover is taken from. */
export const pickThumbnailTimeSec = (durationSec: number | null): number => {
    // Unknown length (some WebM files): early, but past a fade-in.
    if (durationSec === null || !(durationSec > 0)) return EARLIEST_SEC
    const atSec = Math.min(Math.max(durationSec * 0.1, EARLIEST_SEC), LATEST_SEC)
    // A clip shorter than the floor: its middle.
    return atSec < durationSec ? atSec : durationSec / 2
}

// Same shape as the server's buildVideoThumbnailKey (shared/utils/storage-keys):
// under thumbnails/, the anonymously readable prefix, and accepted by the
// server's isVideoThumbnailKey, so a generated cover is handled exactly like
// one a coach uploaded.
export const buildVideoThumbnailKey = (videoId: string) =>
    `thumbnails/${videoId}/${randomUUID()}`

export interface ExtractOptions {
    binary: string
    // Input options placed before `-i`: the probe's whitelists and demuxer
    // for an upload, the mpegts demuxer for one of our own HLS segments.
    inputArgs: string[]
    inputPath: string
    outputPath: string
    timeoutMs?: number
}

/**
 * Writes the frame at `atSec` as a JPEG. Resolves false when ffmpeg finished
 * without writing a frame — the moment lies past the real end of the input.
 */
export const extractFrame = (options: ExtractOptions & { atSec: number }): Promise<boolean> =>
    new Promise((resolve, reject) => {
        const child = spawn(
            options.binary,
            [
                '-y',
                '-v',
                'error',
                // Before `-i`: seek in the input (fast, from the nearest
                // keyframe), then decode up to the exact moment.
                '-ss',
                options.atSec.toFixed(3),
                ...options.inputArgs,
                '-i',
                options.inputPath,
                '-map',
                '0:v:0',
                '-frames:v',
                '1',
                '-vf',
                `scale='min(${THUMBNAIL_WIDTH},iw)':-2`,
                '-q:v',
                '4',
                '-f',
                'image2',
                '-update',
                '1',
                options.outputPath,
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] },
        )
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = (stderr + chunk.toString()).slice(-2000)
        })
        const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
        }, timeoutMs)
        child.on('error', (err: Error) => {
            clearTimeout(timer)
            reject(err)
        })
        child.on('close', (code: number | null) => {
            clearTimeout(timer)
            if (code === 0) {
                fs.stat(options.outputPath).then(
                    (stat) => resolve(stat.size > 0),
                    () => resolve(false),
                )
            } else if (timedOut) {
                reject(new Error(`ffmpeg thumbnail exceeded ${timeoutMs}ms and was killed`))
            } else {
                reject(new Error(stderr.trim() || `ffmpeg thumbnail exited with code ${code}`))
            }
        })
    })

/**
 * The frame at `atSec`, or the first frame when that moment yields nothing
 * (a container whose stated duration is longer than its video). Throws when
 * neither works.
 */
export const extractThumbnail = async (options: ExtractOptions & { atSec: number }) => {
    let lastError: unknown = new Error('ffmpeg wrote no thumbnail frame')
    for (const atSec of options.atSec > 0 ? [options.atSec, 0] : [0]) {
        try {
            if (await extractFrame({ ...options, atSec })) return
        } catch (error) {
            lastError = error
        }
    }
    throw lastError
}

export interface ThumbnailStore {
    upload(key: string, filePath: string): Promise<void>
    publicUrl(key: string): string
}

/**
 * Uploads the JPEG and makes it the video's cover unless the video has one.
 * 'kept': a cover appeared (a coach's upload) while this one was being made.
 * That one wins and this object stays behind unused — the worker's storage
 * account may write under thumbnails/ but not delete there.
 */
export const publishThumbnail = async (
    prisma: Pick<PrismaClient, 'video'>,
    store: ThumbnailStore,
    videoId: string,
    filePath: string,
): Promise<'created' | 'kept'> => {
    const key = buildVideoThumbnailKey(videoId)
    await store.upload(key, filePath)
    // The null check is in the write itself, not a read before it: a cover a
    // coach saved a moment ago is never overwritten.
    const { count } = await prisma.video.updateMany({
        where: { id: videoId, thumbnailUrl: null },
        data: { thumbnailUrl: store.publicUrl(key) },
    })
    return count > 0 ? 'created' : 'kept'
}
