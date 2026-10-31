import { PlanLimitReachedError } from '../../shared/errors/shared.errors'
import { CreateVideoUploadFeature } from '../create-video-upload/create-video-upload.feature'
import { CreateVideoUploadHandler } from '../create-video-upload/create-video-upload.handler'
import { CompleteVideoUploadFeature } from './complete-video-upload.feature'
import { CompleteVideoUploadHandler } from './complete-video-upload.handler'

const limitError = new PlanLimitReachedError({
    limit: 'videos',
    max: 10,
    used: 10,
    planName: 'Free',
})

describe('CreateVideoUploadHandler', () => {
    const build = (o: { refuse?: 'videos' | 'storage' } = {}) => {
        const videoService = {
            createUpload: jest.fn().mockResolvedValue({ videoId: 'v1' }),
        }
        const audit = { record: jest.fn().mockResolvedValue(undefined) }
        const billing = {
            assertWithinLimit: jest.fn(async (_ws: string, limit: string) => {
                if (o.refuse === limit) throw limitError
            }),
        }
        const handler = new CreateVideoUploadHandler(
            videoService as never,
            audit as never,
            billing as never,
        )
        return { handler, videoService, billing, audit }
    }
    const run = (handler: CreateVideoUploadHandler, sizeBytes?: number) =>
        handler.execute(
            new CreateVideoUploadFeature(
                {
                    workspaceId: 'w1',
                    title: 'Удушающие',
                    contentType: 'video/mp4',
                    sizeBytes,
                } as never,
                'u1',
            ),
        )

    it('checks the video count and the declared size against the plan', async () => {
        const { handler, billing, videoService } = build()
        await run(handler, 5_000)
        expect(billing.assertWithinLimit).toHaveBeenCalledWith('w1', 'videos')
        expect(billing.assertWithinLimit).toHaveBeenCalledWith(
            'w1',
            'storage',
            5_000,
        )
        expect(videoService.createUpload).toHaveBeenCalled()
    })

    it('without a declared size still refuses a club already at its storage cap', async () => {
        const { handler, billing } = build()
        await run(handler)
        expect(billing.assertWithinLimit).toHaveBeenCalledWith('w1', 'storage', 1)
    })

    it.each(['videos', 'storage'] as const)(
        'refuses past the %s limit before anything is created',
        async (limit) => {
            const { handler, videoService, audit } = build({ refuse: limit })
            await expect(run(handler, 5_000)).rejects.toBe(limitError)
            expect(videoService.createUpload).not.toHaveBeenCalled()
            expect(audit.record).not.toHaveBeenCalled()
        },
    )
})

describe('CompleteVideoUploadHandler', () => {
    const build = (remaining: number | null) => {
        const videoService = { completeUpload: jest.fn().mockResolvedValue(undefined) }
        const producer = { enqueue: jest.fn().mockResolvedValue(undefined) }
        const audit = { record: jest.fn().mockResolvedValue(undefined) }
        const billing = {
            remaining: jest.fn().mockResolvedValue({
                remaining,
                planName: 'Free',
                max: 2048,
                used: 2048 - (remaining ?? 0),
            }),
        }
        const handler = new CompleteVideoUploadHandler(
            videoService as never,
            producer as never,
            audit as never,
            billing as never,
        )
        return { handler, videoService, producer, billing }
    }
    const run = (handler: CompleteVideoUploadHandler) =>
        handler.execute(
            new CompleteVideoUploadFeature({ workspaceId: 'w1' } as never, 'v1', 'u1'),
        )

    it('hands the service a quota check against the room left, then queues', async () => {
        const { handler, videoService, producer, billing } = build(1_000)
        await expect(run(handler)).resolves.toEqual({ status: 'queued' })
        expect(billing.remaining).toHaveBeenCalledWith('w1', 'storage')
        const { quotaError } = videoService.completeUpload.mock.calls[0][0]
        expect(quotaError(1_000)).toBeNull()
        const err = quotaError(1_001)
        expect(err).toBeInstanceOf(PlanLimitReachedError)
        expect(err.metadata).toEqual({
            limit: 'storage',
            max: 2048,
            used: 1048,
            planName: 'Free',
        })
        expect(producer.enqueue).toHaveBeenCalledWith('v1')
    })

    it('never refuses on an unlimited plan', async () => {
        const { handler, videoService } = build(null)
        await run(handler)
        const { quotaError } = videoService.completeUpload.mock.calls[0][0]
        expect(quotaError(10 ** 12)).toBeNull()
    })

    it('does not queue a refused upload', async () => {
        const { handler, videoService, producer } = build(0)
        videoService.completeUpload.mockRejectedValue(limitError)
        await expect(run(handler)).rejects.toBe(limitError)
        expect(producer.enqueue).not.toHaveBeenCalled()
    })
})
