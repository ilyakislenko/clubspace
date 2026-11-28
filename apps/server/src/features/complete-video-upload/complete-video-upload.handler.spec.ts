import { BadRequestError } from '../../shared/errors/shared.errors'
import { CompleteVideoUploadFeature } from './complete-video-upload.feature'
import { CompleteVideoUploadHandler } from './complete-video-upload.handler'

describe('CompleteVideoUploadHandler', () => {
    const build = () => {
        const videoService = { completeUpload: jest.fn().mockResolvedValue(undefined) }
        const producer = { enqueue: jest.fn().mockResolvedValue(undefined) }
        const audit = { record: jest.fn().mockResolvedValue(undefined) }
        const handler = new CompleteVideoUploadHandler(
            videoService as never,
            producer as never,
            audit as never,
        )
        return { handler, videoService, producer }
    }
    const run = (handler: CompleteVideoUploadHandler) =>
        handler.execute(
            new CompleteVideoUploadFeature('w1', 'v1', 'u1'),
        )

    it('completes the upload in the service, then queues', async () => {
        const { handler, videoService, producer } = build()
        await expect(run(handler)).resolves.toEqual({ status: 'queued' })
        expect(videoService.completeUpload).toHaveBeenCalledWith({
            videoId: 'v1',
            workspaceId: 'w1',
        })
        expect(producer.enqueue).toHaveBeenCalledWith('v1')
    })

    it('hands the parts of a multipart upload to the service before queueing', async () => {
        const { handler, videoService, producer } = build()
        const parts = [
            { partNumber: 2, etag: '"b"' },
            { partNumber: 1, etag: '"a"' },
        ]
        await handler.execute(new CompleteVideoUploadFeature('w1', 'v1', 'u1', parts))
        expect(videoService.completeUpload).toHaveBeenCalledWith({
            videoId: 'v1',
            workspaceId: 'w1',
            parts,
        })
        expect(videoService.completeUpload.mock.invocationCallOrder[0]).toBeLessThan(
            producer.enqueue.mock.invocationCallOrder[0],
        )
    })

    it('does not queue an upload whose parts are refused', async () => {
        const { handler, videoService, producer } = build()
        const refusal = new BadRequestError({ message: 'missing part' })
        videoService.completeUpload.mockRejectedValue(refusal)
        await expect(
            handler.execute(
                new CompleteVideoUploadFeature('w1', 'v1', 'u1', [{ partNumber: 2, etag: '"b"' }]),
            ),
        ).rejects.toBe(refusal)
        expect(producer.enqueue).not.toHaveBeenCalled()
    })

    it('does not queue a refused upload', async () => {
        const { handler, videoService, producer } = build()
        const refusal = new BadRequestError({ message: 'too large' })
        videoService.completeUpload.mockRejectedValue(refusal)
        await expect(run(handler)).rejects.toBe(refusal)
        expect(producer.enqueue).not.toHaveBeenCalled()
    })
})
