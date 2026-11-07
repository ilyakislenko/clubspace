import { join } from 'path'

import type { ProbeResult } from './probe'
import { RejectedInputError } from './probe'
import {
    MAX_REVIEW_CLIP_DURATION_SEC,
    markReviewClipFailed,
    processReviewClip,
    type ReviewClipDeps,
    reviewClipHlsPrefix,
} from './review-clip'

const CLIP = { rawBucket: 'raw-bucket', rawKey: 'raw/review/c1/source', hlsBucket: 'hls-bucket' }

const probeOf = (durationSec: number | null): ProbeResult =>
    ({ formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSec, hasVideo: true }) as unknown as ProbeResult

const build = (o: { clip?: typeof CLIP | null; durationSec?: number | null } = {}) => {
    const deps = {
        db: {
            reviewClip: {
                findUnique: jest.fn(async () => (o.clip === undefined ? CLIP : o.clip)),
                update: jest.fn(async () => ({})),
            },
        },
        makeWorkdir: jest.fn(async () => '/tmp/work'),
        removeWorkdir: jest.fn(async () => undefined),
        download: jest.fn(async () => undefined),
        probe: jest.fn(async () =>
            probeOf(o.durationSec === undefined ? 61.6 : o.durationSec),
        ),
        assertTranscodable: jest.fn(() => 'mov' as never),
        transcode: jest.fn(async () => undefined),
        uploadDir: jest.fn(async () => undefined),
        extractThumbnail: jest.fn(async () => undefined),
        uploadFile: jest.fn(async () => undefined),
        deletePrefix: jest.fn(async () => undefined),
        log: jest.fn(),
    }
    return deps
}

const run = (deps: ReturnType<typeof build>) =>
    processReviewClip(deps as unknown as ReviewClipDeps, 'c1')

const updates = (deps: ReturnType<typeof build>) =>
    deps.db.reviewClip.update.mock.calls.map((c) => (c as unknown[])[0])

describe('processReviewClip', () => {
    it('transcodes privately under hls/review/<id>/ and marks the clip ready', async () => {
        const deps = build()
        await run(deps)
        expect(deps.download).toHaveBeenCalledWith(
            'raw-bucket',
            'raw/review/c1/source',
            join('/tmp/work', 'source'),
        )
        expect(deps.transcode).toHaveBeenCalledWith(
            join('/tmp/work', 'source'),
            'mov',
            join('/tmp/work', 'hls'),
        )
        expect(deps.uploadDir).toHaveBeenCalledWith(
            'hls-bucket',
            'hls/review/c1/',
            join('/tmp/work', 'hls'),
        )
        expect(deps.extractThumbnail).toHaveBeenCalledWith(
            expect.objectContaining({ inputPath: join('/tmp/work', 'source'), demuxer: 'mov' }),
        )
        // The cover stays private, beside the renditions.
        expect(deps.uploadFile).toHaveBeenCalledWith(
            'hls-bucket',
            'hls/review/c1/thumbnail.jpg',
            join('/tmp/work', 'thumbnail.jpg'),
            'image/jpeg',
        )
        expect(updates(deps)).toEqual([
            { where: { id: 'c1' }, data: { status: 'processing', errorMessage: null } },
            {
                where: { id: 'c1' },
                data: {
                    status: 'ready',
                    hlsMasterKey: 'hls/review/c1/master.m3u8',
                    thumbnailKey: 'hls/review/c1/thumbnail.jpg',
                    duration: 62,
                },
            },
        ])
        expect(deps.removeWorkdir).toHaveBeenCalledWith('/tmp/work')
        expect(deps.deletePrefix).not.toHaveBeenCalled()
    })

    it('skips a clip deleted before the job ran', async () => {
        const deps = build({ clip: null })
        await run(deps)
        expect(deps.db.reviewClip.update).not.toHaveBeenCalled()
        expect(deps.makeWorkdir).not.toHaveBeenCalled()
        expect(deps.log).toHaveBeenCalled()
    })

    it('keeps the duration unknown when the probe has none', async () => {
        const deps = build({ durationSec: null })
        await run(deps)
        expect(updates(deps)[1].data).not.toHaveProperty('duration')
    })

    it.each([
        ['an error', new Error('ffmpeg crashed'), 'ffmpeg crashed'],
        ['a non-error', 'boom', 'boom'],
    ])('plays on without a cover when the thumbnail fails (%s)', async (_, thrown, logged) => {
        const deps = build()
        deps.extractThumbnail.mockRejectedValueOnce(thrown)
        await run(deps)
        expect(updates(deps)[1].data).toMatchObject({ status: 'ready', thumbnailKey: null })
        expect(deps.log).toHaveBeenCalledWith('review clip thumbnail failed', {
            clipId: 'c1',
            error: logged,
        })
    })

    it(`refuses a clip longer than ${MAX_REVIEW_CLIP_DURATION_SEC} s, cleaning up`, async () => {
        const deps = build({ durationSec: MAX_REVIEW_CLIP_DURATION_SEC + 1 })
        await expect(run(deps)).rejects.toBeInstanceOf(RejectedInputError)
        expect(deps.transcode).not.toHaveBeenCalled()
        expect(deps.deletePrefix).toHaveBeenCalledWith('hls-bucket', 'hls/review/c1/')
        expect(deps.removeWorkdir).toHaveBeenCalledWith('/tmp/work')
        expect(updates(deps)).toHaveLength(1)
    })

    it('rethrows the failure even when the cleanup fails too', async () => {
        const deps = build()
        deps.transcode.mockRejectedValueOnce(new Error('disk full'))
        deps.deletePrefix.mockRejectedValueOnce(new Error('s3 down'))
        await expect(run(deps)).rejects.toThrow('disk full')
        expect(deps.log).toHaveBeenCalledWith('review clip hls cleanup failed', {
            clipId: 'c1',
            error: 'Error: s3 down',
        })
        expect(deps.removeWorkdir).toHaveBeenCalled()
    })

    it('names the private prefix', () => {
        expect(reviewClipHlsPrefix('x')).toBe('hls/review/x/')
    })
})

describe('markReviewClipFailed', () => {
    const db = () => ({
        reviewClip: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    })

    it('shows the member why a file was refused', async () => {
        const d = db()
        await markReviewClipFailed(d, 'c1', new RejectedInputError('Формат файла не поддерживается'))
        expect(d.reviewClip.update).toHaveBeenCalledWith({
            where: { id: 'c1' },
            data: { status: 'failed', errorMessage: 'Формат файла не поддерживается' },
        })
    })

    it('keeps technical errors out of the message', async () => {
        const d = db()
        await markReviewClipFailed(d, 'c1', new Error('ECONNRESET'))
        const data = (d.reviewClip.update.mock.calls[0] as unknown[])[0] as {
            data: { errorMessage: string }
        }
        expect(data.data.errorMessage).not.toContain('ECONNRESET')
    })

    it('ignores a clip deleted meanwhile', async () => {
        const d = db()
        d.reviewClip.update.mockRejectedValueOnce(new Error('not found'))
        await expect(markReviewClipFailed(d, 'c1', new Error('x'))).resolves.toBeUndefined()
    })
})
