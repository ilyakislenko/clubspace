import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { spawn } from 'child_process'

import {
    buildVideoThumbnailKey,
    extractFrame,
    extractThumbnail,
    pickThumbnailTimeSec,
    publishThumbnail,
    THUMBNAIL_WIDTH,
} from './thumbnail'

jest.mock('child_process', () => ({ spawn: jest.fn() }))

const spawnMock = spawn as unknown as jest.Mock

type FakeChild = EventEmitter & { stderr: EventEmitter; kill: jest.Mock }

const makeChild = (): FakeChild =>
    Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: jest.fn() })

// Every spawn gets a child that plays `script` on the next tick, with the
// args it was started with (the output path is the last one).
const onSpawn = (script: (child: FakeChild, args: string[]) => void | Promise<void>) =>
    spawnMock.mockImplementation((_binary: string, args: string[]) => {
        const child = makeChild()
        setImmediate(() => void script(child, args))
        return child
    })

const writeFrame = async (child: FakeChild, args: string[]) => {
    await fs.writeFile(args.at(-1) as string, 'jpeg')
    child.emit('close', 0)
}

const seekOf = (call: unknown[]) => {
    const args = call[1] as string[]
    return args[args.indexOf('-ss') + 1]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let dir: string
let outputPath: string

beforeEach(async () => {
    spawnMock.mockReset()
    dir = await fs.mkdtemp(join(tmpdir(), 'thumbnail-spec-'))
    outputPath = join(dir, 'thumbnail.jpg')
})

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
})

const options = () => ({
    binary: 'ffmpeg',
    inputArgs: ['-f', 'mov'],
    inputPath: '/tmp/in/source.mp4',
    outputPath,
})

describe('pickThumbnailTimeSec', () => {
    it('takes the frame a tenth of the way in', () => {
        expect(pickThumbnailTimeSec(300)).toBe(30)
    })

    it('stays clear of the intro on a short video and caps a long one at a minute', () => {
        expect(pickThumbnailTimeSec(20)).toBe(3)
        expect(pickThumbnailTimeSec(2 * 60 * 60)).toBe(60)
    })

    it('takes the middle of a clip shorter than the floor', () => {
        expect(pickThumbnailTimeSec(3)).toBe(1.5)
        expect(pickThumbnailTimeSec(1)).toBe(0.5)
    })

    it('falls back to the floor when the length is unknown', () => {
        expect(pickThumbnailTimeSec(null)).toBe(3)
        expect(pickThumbnailTimeSec(0)).toBe(3)
    })
})

describe('buildVideoThumbnailKey', () => {
    it('issues the key shape the server accepts as this video’s cover', () => {
        const parts = buildVideoThumbnailKey('vid-1').split('/')
        expect(parts).toHaveLength(3)
        expect(parts.slice(0, 2)).toEqual(['thumbnails', 'vid-1'])
        expect(parts[2]).toMatch(UUID)
        expect(buildVideoThumbnailKey('vid-1')).not.toBe(buildVideoThumbnailKey('vid-1'))
    })
})

describe('extractFrame', () => {
    it('seeks in the input, keeps its restrictions and writes one scaled JPEG', async () => {
        onSpawn(writeFrame)
        await expect(extractFrame({ ...options(), atSec: 12.5 })).resolves.toBe(true)

        const [binary, args] = spawnMock.mock.calls[0] as [string, string[]]
        expect(binary).toBe('ffmpeg')
        const input = args.indexOf('-i')
        expect(args[input + 1]).toBe('/tmp/in/source.mp4')
        // Input options only count before -i.
        expect(args.indexOf('-ss')).toBeLessThan(input)
        expect(args.indexOf('-f')).toBeLessThan(input)
        expect(seekOf(spawnMock.mock.calls[0])).toBe('12.500')
        expect(args).toEqual(
            expect.arrayContaining(['-frames:v', '1', `scale='min(${THUMBNAIL_WIDTH},iw)':-2`]),
        )
        expect(args.at(-1)).toBe(outputPath)
    })

    it('reports no frame when ffmpeg finishes without writing one', async () => {
        onSpawn((child) => void child.emit('close', 0))
        await expect(extractFrame({ ...options(), atSec: 3 })).resolves.toBe(false)
    })

    it('fails with ffmpeg’s message on a non-zero exit', async () => {
        onSpawn((child) => {
            child.stderr.emit('data', Buffer.from('Invalid data found when processing input\n'))
            child.emit('close', 1)
        })
        await expect(extractFrame({ ...options(), atSec: 3 })).rejects.toThrow(
            'Invalid data found when processing input',
        )

        onSpawn((child) => void child.emit('close', 69))
        await expect(extractFrame({ ...options(), atSec: 3 })).rejects.toThrow(
            'exited with code 69',
        )
    })

    it('surfaces a missing binary', async () => {
        onSpawn((child) => void child.emit('error', new Error('spawn nope ENOENT')))
        await expect(extractFrame({ ...options(), atSec: 3 })).rejects.toThrow('ENOENT')
    })

    it('kills a hung ffmpeg after the timeout', async () => {
        jest.useFakeTimers()
        const child = makeChild()
        spawnMock.mockReturnValueOnce(child)
        const result = extractFrame({ ...options(), atSec: 3, timeoutMs: 1000 })

        jest.advanceTimersByTime(1000)
        expect(child.kill).toHaveBeenCalledWith('SIGKILL')
        child.emit('close', null)

        await expect(result).rejects.toThrow('exceeded 1000ms')
        jest.useRealTimers()
    })
})

describe('extractThumbnail', () => {
    it('takes the first frame when the chosen moment lies past the end', async () => {
        onSpawn(async (child, args) => {
            if (args[args.indexOf('-ss') + 1] === '0.000') await writeFrame(child, args)
            else child.emit('close', 0)
        })
        await extractThumbnail({ ...options(), atSec: 30 })

        expect(spawnMock.mock.calls.map(seekOf)).toEqual(['30.000', '0.000'])
        await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe('jpeg')
    })

    it('retries from the first frame after a failed seek', async () => {
        onSpawn(async (child, args) => {
            if (args[args.indexOf('-ss') + 1] === '0.000') await writeFrame(child, args)
            else child.emit('close', 1)
        })
        await expect(extractThumbnail({ ...options(), atSec: 30 })).resolves.toBeUndefined()
    })

    it('does not seek twice to the start', async () => {
        onSpawn(writeFrame)
        await extractThumbnail({ ...options(), atSec: 0 })
        expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    it('fails when no frame can be had at all', async () => {
        onSpawn((child) => void child.emit('close', 0))
        await expect(extractThumbnail({ ...options(), atSec: 30 })).rejects.toThrow(
            'wrote no thumbnail frame',
        )

        onSpawn((child) => {
            child.stderr.emit('data', Buffer.from('moov atom not found'))
            child.emit('close', 1)
        })
        await expect(extractThumbnail({ ...options(), atSec: 30 })).rejects.toThrow(
            'moov atom not found',
        )
    })
})

describe('publishThumbnail', () => {
    const setup = (count: number) => {
        const prisma = { video: { updateMany: jest.fn().mockResolvedValue({ count }) } }
        const store = {
            upload: jest.fn().mockResolvedValue(undefined),
            publicUrl: jest.fn((key: string) => `https://s3.example.ru/clubspace/${key}`),
        }
        return { prisma, store }
    }

    it('uploads the cover and sets it only on a video that has none', async () => {
        const { prisma, store } = setup(1)
        await expect(
            publishThumbnail(prisma as never, store, 'vid-1', outputPath),
        ).resolves.toBe('created')

        const [key, filePath] = store.upload.mock.calls[0]
        expect(key).toMatch(/^thumbnails\/vid-1\//)
        expect(filePath).toBe(outputPath)
        expect(prisma.video.updateMany).toHaveBeenCalledWith({
            where: { id: 'vid-1', thumbnailUrl: null },
            data: { thumbnailUrl: `https://s3.example.ru/clubspace/${key}` },
        })
    })

    it('keeps a cover that appeared in the meantime', async () => {
        const { prisma, store } = setup(0)
        await expect(
            publishThumbnail(prisma as never, store, 'vid-1', outputPath),
        ).resolves.toBe('kept')
    })
})
