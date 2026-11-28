import { ForbiddenError } from '../../shared/errors/shared.errors'
import { CreateVideoUploadFeature } from './create-video-upload.feature'
import { CreateVideoUploadHandler } from './create-video-upload.handler'

// Which upload shape a size gets (single PUT vs multipart, part count and
// sizes) is decided in VideoService.createUpload — see video.service.spec.ts
// and multipart-upload.spec.ts. This covers the slice around it.
describe('CreateVideoUploadHandler', () => {
    const single = {
        videoId: 'v1',
        rawKey: 'raw/v1/source.mp4',
        upload: { method: 'PUT', url: 'https://s3/x' },
    }
    const multipart = {
        videoId: 'v1',
        rawKey: 'raw/v1/source.mp4',
        upload: {
            method: 'MULTIPART',
            uploadId: 'upload-1',
            partSize: 64 * 1024 * 1024,
            parts: [
                { partNumber: 1, url: 'https://s3/x?partNumber=1' },
                { partNumber: 2, url: 'https://s3/x?partNumber=2' },
            ],
        },
    }
    const build = (result: unknown = single) => {
        const videoService = { createUpload: jest.fn().mockResolvedValue(result) }
        const audit = { record: jest.fn().mockResolvedValue(undefined) }
        const modules = { assertEntitled: jest.fn().mockResolvedValue(undefined) }
        const trialLimits = { assertCanUploadVideo: jest.fn().mockResolvedValue(undefined) }
        const handler = new CreateVideoUploadHandler(
            videoService as never,
            audit as never,
            modules as never,
            trialLimits as never,
        )
        return { handler, videoService, audit, modules, trialLimits }
    }
    const payload = { title: 'T', contentType: 'video/mp4', sizeBytes: 100 * 1024 * 1024 }
    const run = (handler: CreateVideoUploadHandler) =>
        handler.execute(new CreateVideoUploadFeature(payload, 'w1', 'u1'))

    it.each([
        ['a single PUT', single],
        ['a multipart upload', multipart],
    ])('returns %s as the service planned it, and audits the start', async (_case, result) => {
        const { handler, videoService, audit, trialLimits } = build(result)
        await expect(run(handler)).resolves.toEqual(result)
        expect(trialLimits.assertCanUploadVideo).toHaveBeenCalledWith('w1', payload.sizeBytes)
        expect(videoService.createUpload).toHaveBeenCalledWith({ ...payload, workspaceId: 'w1' })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'video.startUpload', targetId: 'v1' }),
        )
    })

    it('starts nothing without the VIDEO module', async () => {
        const { handler, videoService, modules } = build()
        const refusal = new ForbiddenError({ message: 'no module' })
        modules.assertEntitled.mockRejectedValue(refusal)
        await expect(run(handler)).rejects.toBe(refusal)
        expect(videoService.createUpload).not.toHaveBeenCalled()
    })

    it('starts nothing over the trial cap', async () => {
        const { handler, videoService, trialLimits } = build()
        const refusal = new ForbiddenError({ message: 'trial' })
        trialLimits.assertCanUploadVideo.mockRejectedValue(refusal)
        await expect(run(handler)).rejects.toBe(refusal)
        expect(videoService.createUpload).not.toHaveBeenCalled()
    })
})
