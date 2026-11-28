import * as AWS from '@aws-sdk/client-s3'

import type { FilesConfig } from '../files.config'
import { FilesService } from './files.service'

const BASE: FilesConfig = {
    s3Region: 'us-east-1',
    s3BucketName: 'clubspace',
    s3AccessKeyId: 'key',
    s3SecretAccessKey: 'secret',
    s3ForcePathStyle: true,
    s3UploadBucketUrl: 'https://s3.club.example',
    s3Acl: 'private',
}

// Which endpoint a request went to: the client it was sent through.
const sentToHost = async (send: jest.SpyInstance) => {
    const client = send.mock.contexts.at(-1) as AWS.S3
    const endpoint = await client.config.endpoint!()
    return endpoint.hostname
}

describe('FilesService endpoints', () => {
    let send: jest.SpyInstance

    beforeEach(() => {
        send = jest.spyOn(AWS.S3.prototype, 'send').mockResolvedValue({} as never)
    })

    afterEach(() => send.mockRestore())

    it('sends its own requests to the internal endpoint when one is set', async () => {
        const service = new FilesService({ ...BASE, s3InternalUrl: 'http://minio:9000' })

        await service.deleteObject({ bucket: 'clubspace', key: 'raw/v1/source.mp4' })

        expect(await sentToHost(send)).toBe('minio')
    })

    it('still signs URLs for the public origin when an internal endpoint is set', async () => {
        const service = new FilesService({ ...BASE, s3InternalUrl: 'http://minio:9000' })

        const put = await service.getPresignedPutUrl({
            bucket: 'clubspace',
            key: 'raw/v1/source.mp4',
            contentType: 'video/mp4',
        })
        const get = await service.getPresignedGetUrl({ bucket: 'clubspace', key: 'hls/v1/seg.ts' })

        expect(new URL(put.url).host).toBe('s3.club.example')
        expect(new URL(get).host).toBe('s3.club.example')
        expect(send).not.toHaveBeenCalled()
    })

    it('uses the public origin for everything without an internal endpoint', async () => {
        const service = new FilesService(BASE)

        await service.deleteObject({ bucket: 'clubspace', key: 'raw/v1/source.mp4' })

        expect(await sentToHost(send)).toBe('s3.club.example')
    })

    it('defaults the upload limit to the single-PUT maximum', () => {
        expect(new FilesService(BASE).getMaxVideoUploadBytes()).toBe(5120 * 1024 * 1024)
        expect(
            new FilesService({ ...BASE, maxVideoUploadMb: 100 }).getMaxVideoUploadBytes(),
        ).toBe(100 * 1024 * 1024)
    })
})

describe('FilesService public object URLs', () => {
    it('keeps the bucket in the path of an origin that merely contains its name', () => {
        const service = new FilesService({
            ...BASE,
            s3UploadBucketUrl: 'https://media.clubspace.space',
        })

        expect(
            service.getPublicObjectUrl({ bucket: 'clubspace', key: 'thumbnails/v1/c1' }),
        ).toBe('https://media.clubspace.space/clubspace/thumbnails/v1/c1')
    })

    it('uses a virtual-host endpoint as the base', () => {
        const service = new FilesService({
            ...BASE,
            s3UploadBucketUrl: 'https://clubspace.s3.example.com/',
        })

        expect(
            service.getPublicObjectUrl({ bucket: 'clubspace', key: 'thumbnails/v1/c1' }),
        ).toBe('https://clubspace.s3.example.com/thumbnails/v1/c1')
    })

    it('signs path-style uploads for an origin that merely contains the bucket name', async () => {
        const service = new FilesService({
            ...BASE,
            s3UploadBucketUrl: 'https://media.clubspace.space',
        })

        const put = await service.getPresignedPutUrl({
            bucket: 'clubspace',
            key: 'raw/v1/source.mp4',
            contentType: 'video/mp4',
        })

        expect(new URL(put.url).host).toBe('media.clubspace.space')
        expect(new URL(put.url).pathname).toBe('/clubspace/raw/v1/source.mp4')
    })
})

describe('FilesService multipart uploads', () => {
    let send: jest.SpyInstance

    beforeEach(() => {
        send = jest
            .spyOn(AWS.S3.prototype, 'send')
            .mockResolvedValue({ UploadId: 'upload-1' } as never)
    })

    afterEach(() => send.mockRestore())

    const service = () => new FilesService({ ...BASE, s3InternalUrl: 'http://minio:9000' })
    const object = { bucket: 'clubspace', key: 'raw/v1/source.mp4' }

    it('defaults parts to 64 MiB', () => {
        expect(new FilesService(BASE).getMultipartPartBytes()).toBe(64 * 1024 * 1024)
        expect(
            new FilesService({ ...BASE, multipartPartMb: 16 }).getMultipartPartBytes(),
        ).toBe(16 * 1024 * 1024)
    })

    it('starts, completes and aborts on the internal endpoint', async () => {
        const files = service()

        await expect(
            files.createMultipartUpload({ ...object, contentType: 'video/mp4' }),
        ).resolves.toBe('upload-1')
        expect(send.mock.calls[0][0]).toBeInstanceOf(AWS.CreateMultipartUploadCommand)
        expect(send.mock.calls[0][0].input).toEqual({
            Bucket: 'clubspace',
            Key: 'raw/v1/source.mp4',
            ContentType: 'video/mp4',
        })
        expect(await sentToHost(send)).toBe('minio')

        await files.completeMultipartUpload({
            ...object,
            uploadId: 'upload-1',
            parts: [
                { partNumber: 1, etag: '"a"' },
                { partNumber: 2, etag: '"b"' },
            ],
        })
        expect(send.mock.calls[1][0]).toBeInstanceOf(AWS.CompleteMultipartUploadCommand)
        expect(send.mock.calls[1][0].input).toEqual({
            Bucket: 'clubspace',
            Key: 'raw/v1/source.mp4',
            UploadId: 'upload-1',
            MultipartUpload: {
                Parts: [
                    { PartNumber: 1, ETag: '"a"' },
                    { PartNumber: 2, ETag: '"b"' },
                ],
            },
        })

        await files.abortMultipartUpload({ ...object, uploadId: 'upload-1' })
        expect(send.mock.calls[2][0]).toBeInstanceOf(AWS.AbortMultipartUploadCommand)
        expect(send.mock.calls[2][0].input).toEqual({
            Bucket: 'clubspace',
            Key: 'raw/v1/source.mp4',
            UploadId: 'upload-1',
        })
        expect(await sentToHost(send)).toBe('minio')
    })

    it('refuses an answer without an upload id', async () => {
        send.mockResolvedValue({} as never)
        await expect(
            service().createMultipartUpload({ ...object, contentType: 'video/mp4' }),
        ).rejects.toThrow('no multipart upload id')
    })

    it('signs part URLs for the public origin, naming the upload and part', async () => {
        const url = new URL(
            await service().getPresignedUploadPartUrl({
                ...object,
                uploadId: 'upload-1',
                partNumber: 3,
                contentLength: 1_000,
                expiresInSeconds: 3_600,
            }),
        )

        expect(url.host).toBe('s3.club.example')
        expect(url.pathname).toBe('/clubspace/raw/v1/source.mp4')
        expect(url.searchParams.get('uploadId')).toBe('upload-1')
        expect(url.searchParams.get('partNumber')).toBe('3')
        expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
        expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length')
        expect(send).not.toHaveBeenCalled()
    })
})
