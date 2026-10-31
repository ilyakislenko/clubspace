import { UnrecoverableError } from 'bullmq'
import { spawn } from 'child_process'

// Uploads are untrusted bytes that only *claim* to be video/*. ffmpeg picks a
// demuxer by sniffing the content, so a "video" can just as well be an HLS or
// concat playlist that makes ffmpeg open other local files or URLs, or a rare
// container whose demuxer is a memory-corruption bug waiting to happen. Every
// file is therefore probed first, restricted to the four containers phones and
// cameras actually produce, and ffmpeg is then pinned to the demuxer the probe
// found — it never gets to choose on its own.

// libavformat demuxer names, exactly as ffprobe reports them in format_name.
// One demuxer covers mov/mp4 (plus 3gp/m4a/mj2), one covers matroska/webm.
const DEMUXERS = {
    mov: 'mov,mp4,m4a,3gp,3g2,mj2',
    matroska: 'matroska,webm',
} as const

export type Demuxer = keyof typeof DEMUXERS

export const FORMAT_WHITELIST = Object.values(DEMUXERS).join(',')

// Local files and pipes only: no http(s), tcp, concat, data or subfile URLs,
// so nothing inside a container can make ffmpeg reach the network or another
// path on disk.
export const PROTOCOL_WHITELIST = 'file,pipe'

// The upload itself is unacceptable. Unrecoverable: the same bytes fail the
// same way on every attempt, so BullMQ should not spend retries (and queue
// time) on them. The message is shown to the coach under "Ошибка обработки",
// and these are not reported to Sentry — a wrong file is not a fault.
export class RejectedInputError extends UnrecoverableError {
    constructor(message: string) {
        super(message)
        this.name = 'RejectedInputError'
    }
}

const SUPPORTED_FORMATS_HINT = 'Загрузите видео в формате MP4, MOV, MKV или WebM.'

export interface ProbeResult {
    formatName: string
    // null when the container does not state a duration (some WebM files).
    durationSec: number | null
    hasVideo: boolean
}

export interface TranscodeLimits {
    maxInputBytes: number
    maxDurationSec: number
}

// Input options for both ffprobe and ffmpeg. They must precede `-i`, where
// they apply to the input being opened rather than to an output.
export const restrictedInputArgs = (demuxer?: Demuxer): string[] => [
    '-protocol_whitelist',
    PROTOCOL_WHITELIST,
    '-format_whitelist',
    FORMAT_WHITELIST,
    ...(demuxer ? ['-f', demuxer] : []),
]

export const parseProbeOutput = (stdout: string): ProbeResult => {
    let parsed: unknown
    try {
        parsed = JSON.parse(stdout)
    } catch {
        throw new RejectedInputError(
            `Не удалось прочитать файл как видео. ${SUPPORTED_FORMATS_HINT}`,
        )
    }
    const { format, streams } = (parsed ?? {}) as {
        format?: { format_name?: unknown; duration?: unknown }
        streams?: Array<{ codec_type?: unknown }>
    }
    const duration = Number(format?.duration)
    return {
        formatName: typeof format?.format_name === 'string' ? format.format_name : '',
        durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
        hasVideo: (streams ?? []).some((s) => s.codec_type === 'video'),
    }
}

const formatDuration = (sec: number) => {
    const minutes = Math.round(sec / 60)
    return minutes % 60 === 0 ? `${minutes / 60} ч` : `${minutes} мин`
}

const formatSize = (bytes: number) =>
    bytes >= 1024 ** 3
        ? `${Number((bytes / 1024 ** 3).toFixed(1))} ГБ`
        : `${Math.round(bytes / 1024 ** 2)} МБ`

export const assertInputSize = (bytes: number | undefined, limits: TranscodeLimits) => {
    if (bytes !== undefined && bytes > limits.maxInputBytes) {
        throw new RejectedInputError(
            `Файл больше ${formatSize(limits.maxInputBytes)}. Сожмите видео или разделите его на части.`,
        )
    }
}

export const assertTranscodable = (
    probe: ProbeResult,
    limits: TranscodeLimits,
): Demuxer => {
    const demuxer = (Object.keys(DEMUXERS) as Demuxer[]).find(
        (name) => DEMUXERS[name] === probe.formatName,
    )
    if (!demuxer) {
        throw new RejectedInputError(`Формат файла не поддерживается. ${SUPPORTED_FORMATS_HINT}`)
    }
    if (!probe.hasVideo) {
        throw new RejectedInputError(`В файле нет видеодорожки. ${SUPPORTED_FORMATS_HINT}`)
    }
    // An unknown duration is let through: the transcode timeout still bounds
    // how long such a file can hold a worker.
    if (probe.durationSec !== null && probe.durationSec > limits.maxDurationSec) {
        throw new RejectedInputError(
            `Видео длиннее ${formatDuration(limits.maxDurationSec)}. Разделите его на части.`,
        )
    }
    return demuxer
}

// Runs ffprobe under the same whitelists as the transcode. A file in any other
// container fails right here — its demuxer is never even opened.
export const probeVideo = (
    inputPath: string,
    options: { binary: string; timeoutMs: number },
): Promise<ProbeResult> =>
    new Promise((resolve, reject) => {
        const child = spawn(
            options.binary,
            [
                '-v',
                'error',
                ...restrictedInputArgs(),
                '-show_entries',
                'format=format_name,duration:stream=codec_type',
                '-of',
                'json',
                inputPath,
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString()
        })
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = (stderr + chunk.toString()).slice(-2000)
        })
        const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
        child.on('error', (err: Error) => {
            clearTimeout(timer)
            reject(err)
        })
        child.on('close', (code: number | null) => {
            clearTimeout(timer)
            if (code === 0) {
                try {
                    resolve(parseProbeOutput(stdout))
                } catch (error) {
                    reject(error)
                }
                return
            }
            // A non-zero exit is ffprobe refusing the input: a container
            // outside the whitelist, or bytes no allowed demuxer can parse.
            console.warn('[video-worker] ffprobe rejected input', {
                code,
                stderr: stderr.trim(),
            })
            reject(
                new RejectedInputError(
                    `Не удалось прочитать файл как видео. ${SUPPORTED_FORMATS_HINT}`,
                ),
            )
        })
    })
