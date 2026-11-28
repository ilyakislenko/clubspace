import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { AbortVideoUploadFeature } from './abort-video-upload.feature'
import { AbortVideoUploadHandler } from './abort-video-upload.handler'

describe('AbortVideoUploadHandler', () => {
    const build = () => {
        const videoService = {
            abortUpload: jest.fn().mockResolvedValue({ status: 'aborted' }),
        }
        const audit = { record: jest.fn().mockResolvedValue(undefined) }
        const handler = new AbortVideoUploadHandler(
            videoService as never,
            audit as never,
        )
        return { handler, videoService, audit }
    }
    const run = (handler: AbortVideoUploadHandler) =>
        handler.execute(new AbortVideoUploadFeature('w1', 'v1', 'u1'))

    it('aborts the upload in the service and records who did it', async () => {
        const { handler, videoService, audit } = build()
        await expect(run(handler)).resolves.toEqual({ status: 'aborted' })
        expect(videoService.abortUpload).toHaveBeenCalledWith({
            videoId: 'v1',
            workspaceId: 'w1',
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'video.abortUpload',
                targetId: 'v1',
                workspaceId: 'w1',
                actorId: 'u1',
            }),
        )
    })

    it.each([
        ['an unknown video', new NotFoundError({ message: 'Видео не найдено' })],
        ['a video already handed to transcoding', new BadRequestError({ message: 'uploaded' })],
    ])('records nothing for %s', async (_case, refusal) => {
        const { handler, videoService, audit } = build()
        videoService.abortUpload.mockRejectedValue(refusal)
        await expect(run(handler)).rejects.toBe(refusal)
        expect(audit.record).not.toHaveBeenCalled()
    })
})
