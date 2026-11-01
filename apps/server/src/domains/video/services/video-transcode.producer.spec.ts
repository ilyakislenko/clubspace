import type { Queue } from 'bullmq'

import { VideoTranscodeProducer } from './video-transcode.producer'

const makeQueue = (existing: { isFailed: jest.Mock; remove: jest.Mock } | undefined) =>
    ({
        getJob: jest.fn().mockResolvedValue(existing),
        add: jest.fn().mockResolvedValue({}),
    }) as unknown as Queue & { getJob: jest.Mock; add: jest.Mock }

describe('VideoTranscodeProducer', () => {
    it('enqueues a deduped job that keeps failures for a week', async () => {
        const queue = makeQueue(undefined)

        await new VideoTranscodeProducer(queue).enqueue('v1')

        expect(queue.getJob).toHaveBeenCalledWith('transcode-v1')
        expect(queue.add).toHaveBeenCalledWith(
            'video-transcode',
            { videoId: 'v1' },
            expect.objectContaining({
                jobId: 'transcode-v1',
                attempts: 3,
                removeOnComplete: true,
                removeOnFail: { age: 7 * 24 * 60 * 60 },
            }),
        )
    })

    it('clears a kept failed job so the video can be transcoded again', async () => {
        const failed = {
            isFailed: jest.fn().mockResolvedValue(true),
            remove: jest.fn().mockResolvedValue(undefined),
        }
        const queue = makeQueue(failed)

        await new VideoTranscodeProducer(queue).enqueue('v1')

        expect(failed.remove).toHaveBeenCalled()
        expect(failed.remove.mock.invocationCallOrder[0]).toBeLessThan(
            queue.add.mock.invocationCallOrder[0],
        )
    })

    it('leaves a pending or running job in place', async () => {
        const active = {
            isFailed: jest.fn().mockResolvedValue(false),
            remove: jest.fn(),
        }
        const queue = makeQueue(active)

        await new VideoTranscodeProducer(queue).enqueue('v1')

        expect(active.remove).not.toHaveBeenCalled()
        expect(queue.add).toHaveBeenCalled()
    })
})
