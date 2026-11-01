import { EventEmitter } from 'events'

import { spawn } from 'child_process'

import {
    assertInputSize,
    assertTranscodable,
    FORMAT_WHITELIST,
    parseProbeOutput,
    probeVideo,
    RejectedInputError,
    restrictedInputArgs,
} from './probe'

jest.mock('child_process', () => ({ spawn: jest.fn() }))

const spawnMock = spawn as unknown as jest.Mock

const LIMITS = { maxInputBytes: 5120 * 1024 * 1024, maxDurationSec: 4 * 60 * 60 }

// ffprobe -show_entries format=format_name,duration:stream=codec_type -of json
const probeJson = (formatName: string, duration: string | undefined, codecTypes: string[]) =>
    JSON.stringify({
        streams: codecTypes.map((codec_type) => ({ codec_type })),
        format: { format_name: formatName, ...(duration ? { duration } : {}) },
    })

// A stand-in for the ffprobe child process that replays canned output.
const fakeChild = () => {
    const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: jest.fn(),
    })
    spawnMock.mockReturnValueOnce(child)
    return child
}

describe('parseProbeOutput', () => {
    it('reads the demuxer, duration and whether there is a video stream', () => {
        expect(
            parseProbeOutput(probeJson('mov,mp4,m4a,3gp,3g2,mj2', '62.5', ['video', 'audio'])),
        ).toEqual({ formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSec: 62.5, hasVideo: true })
    })

    it('treats a missing or unparsable duration as unknown', () => {
        expect(parseProbeOutput(probeJson('matroska,webm', undefined, ['video'])).durationSec).toBeNull()
        expect(parseProbeOutput(probeJson('matroska,webm', 'N/A', ['video'])).durationSec).toBeNull()
    })

    it('copes with output that has no format or streams', () => {
        expect(parseProbeOutput('{}')).toEqual({ formatName: '', durationSec: null, hasVideo: false })
    })

    it('rejects output that is not JSON', () => {
        expect(() => parseProbeOutput('garbage')).toThrow(RejectedInputError)
    })
})

describe('assertTranscodable', () => {
    it.each([
        ['mov,mp4,m4a,3gp,3g2,mj2', 'mov'],
        ['matroska,webm', 'matroska'],
    ])('accepts %s with a video stream and pins the %s demuxer', (formatName, demuxer) => {
        expect(
            assertTranscodable({ formatName, durationSec: 600, hasVideo: true }, LIMITS),
        ).toBe(demuxer)
    })

    it.each(['hls', 'concat', 'image2', 'avi', 'mpegts', 'gif', ''])(
        'refuses the %s container',
        (formatName) => {
            expect(() =>
                assertTranscodable({ formatName, durationSec: 10, hasVideo: true }, LIMITS),
            ).toThrow('Формат файла не поддерживается')
        },
    )

    it('refuses an allowed container with no video stream', () => {
        expect(() =>
            assertTranscodable(
                { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSec: 10, hasVideo: false },
                LIMITS,
            ),
        ).toThrow('В файле нет видеодорожки')
    })

    it('refuses a video longer than the limit, in hours or minutes', () => {
        const probe = { formatName: 'matroska,webm', durationSec: 4 * 60 * 60 + 1, hasVideo: true }
        expect(() => assertTranscodable(probe, LIMITS)).toThrow('Видео длиннее 4 ч')
        expect(() => assertTranscodable(probe, { ...LIMITS, maxDurationSec: 90 * 60 })).toThrow(
            'Видео длиннее 90 мин',
        )
    })

    it('lets an unknown duration through', () => {
        expect(
            assertTranscodable(
                { formatName: 'matroska,webm', durationSec: null, hasVideo: true },
                LIMITS,
            ),
        ).toBe('matroska')
    })

    it('throws errors BullMQ will not retry', () => {
        expect(() =>
            assertTranscodable({ formatName: 'hls', durationSec: 1, hasVideo: true }, LIMITS),
        ).toThrow(expect.objectContaining({ name: 'RejectedInputError' }))
    })
})

describe('assertInputSize', () => {
    it('passes a file within the limit or of unknown size', () => {
        expect(() => assertInputSize(LIMITS.maxInputBytes, LIMITS)).not.toThrow()
        expect(() => assertInputSize(undefined, LIMITS)).not.toThrow()
    })

    it('refuses a larger file, in GB or MB', () => {
        expect(() => assertInputSize(LIMITS.maxInputBytes + 1, LIMITS)).toThrow('Файл больше 5 ГБ')
        expect(() =>
            assertInputSize(600 * 1024 * 1024, { ...LIMITS, maxInputBytes: 500 * 1024 * 1024 }),
        ).toThrow('Файл больше 500 МБ')
    })
})

describe('restrictedInputArgs', () => {
    it('limits protocols and formats, and forces the demuxer when given', () => {
        expect(restrictedInputArgs('mov')).toEqual([
            '-protocol_whitelist',
            'file,pipe',
            '-format_whitelist',
            FORMAT_WHITELIST,
            '-f',
            'mov',
        ])
        expect(restrictedInputArgs()).not.toContain('-f')
        expect(FORMAT_WHITELIST.split(',')).toEqual(
            expect.arrayContaining(['mov', 'mp4', 'matroska', 'webm']),
        )
    })
})

describe('probeVideo', () => {
    beforeEach(() => spawnMock.mockReset())

    it('runs ffprobe under the whitelists and parses its JSON', async () => {
        const child = fakeChild()
        const result = probeVideo('/tmp/in/source.mp4', { binary: 'ffprobe', timeoutMs: 1000 })

        child.stdout.emit('data', Buffer.from(probeJson('mov,mp4,m4a,3gp,3g2,mj2', '5', ['video'])))
        child.emit('close', 0)

        await expect(result).resolves.toEqual({
            formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
            durationSec: 5,
            hasVideo: true,
        })
        const [binary, args] = spawnMock.mock.calls[0]
        expect(binary).toBe('ffprobe')
        expect(args).toEqual(expect.arrayContaining(restrictedInputArgs()))
        expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('/tmp/in/source.mp4'))
        expect(args.at(-1)).toBe('/tmp/in/source.mp4')
    })

    it('turns a non-zero exit into a refusal', async () => {
        const child = fakeChild()
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const result = probeVideo('/tmp/in/source.mp4', { binary: 'ffprobe', timeoutMs: 1000 })

        child.stderr.emit('data', Buffer.from('Format hls is not on the format whitelist'))
        child.emit('close', 1)

        await expect(result).rejects.toThrow(RejectedInputError)
        await expect(result).rejects.toThrow('Не удалось прочитать файл как видео')
        warn.mockRestore()
    })

    it('rejects unparsable output from a zero exit', async () => {
        const child = fakeChild()
        const result = probeVideo('/tmp/in/source.mp4', { binary: 'ffprobe', timeoutMs: 1000 })

        child.stdout.emit('data', Buffer.from('not json'))
        child.emit('close', 0)

        await expect(result).rejects.toThrow(RejectedInputError)
    })

    it('surfaces a missing binary as an ordinary, retryable error', async () => {
        const child = fakeChild()
        const result = probeVideo('/tmp/in/source.mp4', { binary: 'nope', timeoutMs: 1000 })

        child.emit('error', new Error('spawn nope ENOENT'))

        await expect(result).rejects.toThrow('spawn nope ENOENT')
        await expect(result).rejects.not.toBeInstanceOf(RejectedInputError)
    })

    it('kills a hung ffprobe after the timeout', async () => {
        jest.useFakeTimers()
        const child = fakeChild()
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const result = probeVideo('/tmp/in/source.mp4', { binary: 'ffprobe', timeoutMs: 1000 })

        jest.advanceTimersByTime(1000)
        expect(child.kill).toHaveBeenCalledWith('SIGKILL')
        child.emit('close', null)

        await expect(result).rejects.toThrow(RejectedInputError)
        warn.mockRestore()
        jest.useRealTimers()
    })
})
