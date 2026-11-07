import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { spawn } from 'child_process'
import { createScheduler, createWorker } from 'tesseract.js'

import {
    ENG_LANG_PATH,
    linesOf,
    openFrameReader,
    sampleFrames,
    scanChapters,
} from './chapter-ocr'
import { COARSE_STEP_SEC } from './chapters'

jest.mock('child_process', () => ({ spawn: jest.fn() }))
jest.mock('tesseract.js', () => ({
    createScheduler: jest.fn(),
    createWorker: jest.fn(),
    OEM: { LSTM_ONLY: 1 },
}))
jest.mock('@tesseract.js-data/eng', () => ({
    __esModule: true,
    default: { code: 'eng', gzip: true, langPath: '/modules/@tesseract.js-data/eng/4.0.0' },
}))

const spawnMock = spawn as unknown as jest.Mock
const createSchedulerMock = createScheduler as unknown as jest.Mock
const createWorkerMock = createWorker as unknown as jest.Mock

type FakeChild = EventEmitter & { stderr: EventEmitter; kill: jest.Mock }

// Every spawn gets a child that plays `script` on the next tick, with the
// args it was started with (the output pattern is the last one).
const onSpawn = (script: (child: FakeChild, args: string[]) => void | Promise<void>) =>
    spawnMock.mockImplementation((_binary: string, args: string[]) => {
        const child = Object.assign(new EventEmitter(), {
            stderr: new EventEmitter(),
            kill: jest.fn(),
        })
        setImmediate(() => void script(child, args))
        return child
    })

// ffmpeg writing `count` frames next to the output pattern.
const writeFrames = (count: number) => async (child: FakeChild, args: string[]) => {
    const dir = dirname(args.at(-1) as string)
    for (let idx = 1; idx <= count; idx += 1) {
        await fs.writeFile(join(dir, `${String(idx).padStart(5, '0')}.jpg`), 'jpeg')
    }
    child.emit('close', 0)
}

type TesseractLine = {
    text: string
    confidence: number
    bbox: { x0: number; x1: number; y0: number; y1: number }
}

const tesseractLine = (
    text: string,
    confidence: number,
    y0: number,
    y1: number,
): TesseractLine => ({
    text,
    confidence,
    bbox: { x0: 0, x1: 100, y0, y1 },
})

const page = (...lines: TesseractLine[]) => ({
    data: { blocks: [{ paragraphs: [{ lines }] }] },
})

let dir: string

beforeEach(async () => {
    spawnMock.mockReset()
    createSchedulerMock.mockReset()
    createWorkerMock.mockReset()
    dir = await fs.mkdtemp(join(tmpdir(), 'chapter-ocr-spec-'))
})

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
})

const options = () => ({
    binary: 'ffmpeg',
    inputArgs: ['-protocol_whitelist', 'file,pipe', '-f', 'mov'],
    inputPath: '/tmp/in/source.mp4',
    timeoutMs: 60_000,
})

describe('ENG_LANG_PATH', () => {
    it('reads the LSTM model from the installed data package', () => {
        expect(ENG_LANG_PATH).toBe('/modules/@tesseract.js-data/eng/4.0.0_best_int')
    })
})

describe('sampleFrames', () => {
    it('cuts a window of scaled frames from the restricted input, timed from its start', async () => {
        onSpawn(writeFrames(3))
        await fs.writeFile(join(dir, 'notes.txt'), 'not a frame')
        const frames = await sampleFrames({
            ...options(),
            outputDir: dir,
            window: { startSec: 291.5, durationSec: 8, stepSec: 0.5 },
        })

        expect(frames).toEqual([
            { atSec: 291.5, path: join(dir, '00001.jpg') },
            { atSec: 292, path: join(dir, '00002.jpg') },
            { atSec: 292.5, path: join(dir, '00003.jpg') },
        ])
        const [binary, args] = spawnMock.mock.calls[0]
        expect(binary).toBe('ffmpeg')
        expect(args.slice(0, 13)).toEqual([
            '-y',
            '-v',
            'error',
            '-ss',
            '291.500',
            '-t',
            '8.000',
            '-protocol_whitelist',
            'file,pipe',
            '-f',
            'mov',
            '-i',
            '/tmp/in/source.mp4',
        ])
        expect(args).toContain('fps=1/0.5,scale=960:-2')
        expect(args.at(-1)).toBe(join(dir, '%05d.jpg'))
    })

    it('reads to the end of the video when the window has no length', async () => {
        onSpawn(writeFrames(0))
        await expect(
            sampleFrames({
                ...options(),
                outputDir: dir,
                window: { startSec: 0, stepSec: COARSE_STEP_SEC },
            }),
        ).resolves.toEqual([])
        const args = spawnMock.mock.calls[0][1] as string[]
        expect(args).not.toContain('-t')
        expect(args).toContain('fps=1/3,scale=960:-2')
    })

    it('fails with ffmpeg’s message, or its exit code when it said nothing', async () => {
        const window = { startSec: 0, stepSec: 3 }
        onSpawn((child) => {
            child.stderr.emit('data', Buffer.from('moov atom not found\n'))
            child.emit('close', 1)
        })
        await expect(sampleFrames({ ...options(), outputDir: dir, window })).rejects.toThrow(
            'moov atom not found',
        )
        onSpawn((child) => void child.emit('close', 69))
        await expect(sampleFrames({ ...options(), outputDir: dir, window })).rejects.toThrow(
            'ffmpeg frames exited with code 69',
        )
    })

    it('surfaces a missing binary and a missing output directory', async () => {
        const window = { startSec: 0, stepSec: 3 }
        onSpawn((child) => void child.emit('error', new Error('spawn nope ENOENT')))
        await expect(sampleFrames({ ...options(), outputDir: dir, window })).rejects.toThrow(
            'ENOENT',
        )
        onSpawn((child) => void child.emit('close', 0))
        await expect(
            sampleFrames({ ...options(), outputDir: join(dir, 'gone'), window }),
        ).rejects.toThrow('ENOENT')
    })

    it('kills a hung ffmpeg after the timeout', async () => {
        jest.useFakeTimers()
        try {
            let child: FakeChild | undefined
            spawnMock.mockImplementation(() => {
                child = Object.assign(new EventEmitter(), {
                    stderr: new EventEmitter(),
                    kill: jest.fn(),
                })
                return child
            })
            const pending = sampleFrames({
                ...options(),
                timeoutMs: 1000,
                outputDir: dir,
                window: { startSec: 0, stepSec: 3 },
            })
            jest.advanceTimersByTime(1000)
            expect(child?.kill).toHaveBeenCalledWith('SIGKILL')
            child?.emit('close', null)
            await expect(pending).rejects.toThrow('ffmpeg frames exceeded 1000ms')
        } finally {
            jest.useRealTimers()
        }
    })
})

describe('linesOf', () => {
    it('flattens Tesseract’s blocks into lines with any letter in them', () => {
        const { data } = page(
            tesseractLine('  SLX Toe Hold \n', 96.4, 438, 463),
            tesseractLine('| 3 —', 70, 300, 320),
        )
        expect(linesOf(data.blocks as never)).toEqual([
            { text: 'SLX Toe Hold', confidence: 96.4, top: 438, height: 25 },
        ])
    })

    it('reads a page without blocks as no lines', () => {
        expect(linesOf(null)).toEqual([])
    })
})

const fakeOcr = (recognize: jest.Mock) => {
    const scheduler = {
        addWorker: jest.fn(),
        addJob: jest.fn((_action: string, path: string) => recognize(path)),
        terminate: jest.fn().mockResolvedValue(undefined),
    }
    createSchedulerMock.mockReturnValue(scheduler)
    const workers: Array<{ setParameters: jest.Mock }> = []
    createWorkerMock.mockImplementation(async () => {
        const worker = { setParameters: jest.fn().mockResolvedValue({}) }
        workers.push(worker)
        return worker
    })
    return { scheduler, workers }
}

describe('openFrameReader', () => {
    it('starts offline Tesseract workers that keep quiet', async () => {
        const { scheduler, workers } = fakeOcr(jest.fn())
        const reader = await openFrameReader({ ...options(), workdir: dir })

        expect(createWorkerMock).toHaveBeenCalledTimes(2)
        expect(createWorkerMock).toHaveBeenCalledWith('eng', 1, {
            langPath: '/modules/@tesseract.js-data/eng/4.0.0_best_int',
            gzip: true,
            cacheMethod: 'none',
        })
        expect(scheduler.addWorker).toHaveBeenCalledTimes(2)
        for (const worker of workers) {
            expect(worker.setParameters).toHaveBeenCalledWith({ debug_file: '/dev/null' })
        }
        await reader.close()
        expect(scheduler.terminate).toHaveBeenCalled()
    })

    it('reads each frame of a window and removes the frames afterwards', async () => {
        const recognize = jest.fn(async (path: string) =>
            path.endsWith('00002.jpg')
                ? page(tesseractLine('Review', 96, 440, 464))
                : { data: { blocks: null } },
        )
        const { scheduler } = fakeOcr(recognize)
        onSpawn(writeFrames(2))
        const reader = await openFrameReader({ ...options(), workdir: dir })

        await expect(reader.read({ startSec: 1116.5, durationSec: 5, stepSec: 0.5 })).resolves.toEqual(
            [
                { atSec: 1116.5, lines: [] },
                { atSec: 1117, lines: [{ text: 'Review', confidence: 96, top: 440, height: 24 }] },
            ],
        )
        expect(scheduler.addJob).toHaveBeenCalledWith(
            'recognize',
            join(dir, 'frames-0', '00001.jpg'),
            {},
            { blocks: true },
        )
        // A second window gets its own directory.
        await reader.read({ startSec: 0, durationSec: 1, stepSec: 0.5 })
        expect(dirname(spawnMock.mock.calls[1][1].at(-1))).toBe(join(dir, 'frames-1'))
        await expect(fs.readdir(dir)).resolves.toEqual([])
    })

    it('removes the frames when ffmpeg fails', async () => {
        fakeOcr(jest.fn())
        onSpawn((child) => void child.emit('close', 1))
        const reader = await openFrameReader({ ...options(), workdir: dir })
        await expect(reader.read({ startSec: 0, stepSec: 3 })).rejects.toThrow('code 1')
        await expect(fs.readdir(dir)).resolves.toEqual([])
    })

    it('stops the started workers when one fails to start', async () => {
        const { scheduler } = fakeOcr(jest.fn())
        createWorkerMock.mockRejectedValueOnce(new Error('no traineddata'))
        await expect(openFrameReader({ ...options(), workdir: dir })).rejects.toThrow(
            'no traineddata',
        )
        expect(scheduler.terminate).toHaveBeenCalled()
    })
})

describe('scanChapters', () => {
    it('reads the video and stops the workers', async () => {
        const { scheduler } = fakeOcr(jest.fn(async () => ({ data: { blocks: null } })))
        onSpawn(writeFrames(4))
        await expect(scanChapters({ ...options(), workdir: dir })).resolves.toEqual({
            chapters: [],
            candidates: 0,
            coarseFrames: 4,
        })
        expect(scheduler.terminate).toHaveBeenCalled()
    })

    it('stops the workers when reading fails', async () => {
        const { scheduler } = fakeOcr(jest.fn())
        onSpawn((child) => void child.emit('error', new Error('spawn ffmpeg ENOENT')))
        await expect(scanChapters({ ...options(), workdir: dir })).rejects.toThrow('ENOENT')
        expect(scheduler.terminate).toHaveBeenCalled()
    })
})
