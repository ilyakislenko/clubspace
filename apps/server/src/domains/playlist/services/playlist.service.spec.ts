import { PlaylistService } from './playlist.service'

describe('PlaylistService.createThumbnailUpload', () => {
    const setup = (course: { id: string } | null) => {
        const prisma = {
            course: { findFirst: jest.fn().mockResolvedValue(course) },
        }
        const files = {
            getDefaultBucketName: jest.fn().mockReturnValue('clubspace'),
            getPresignedPutUrl: jest
                .fn()
                .mockResolvedValue({ url: 'https://s3/put', method: 'PUT' }),
            getPublicObjectUrl: jest.fn(
                ({ bucket, key }: { bucket: string; key: string }) =>
                    `https://s3/${bucket}/${key}`,
            ),
        }
        const service = new PlaylistService(prisma as never, files as never)
        return { service, files }
    }

    it('puts the cover under thumbnails/, the anonymously readable prefix', async () => {
        const { service, files } = setup({ id: 'c1' })
        const out = await service.createThumbnailUpload({
            workspaceId: 'w1',
            playlistId: 'c1',
            contentType: 'image/jpeg',
        })
        // Anything outside thumbnails/ (or subtitles/) is private in the
        // bucket policy, so the unsigned public URL would come back 403.
        expect(out.key).toMatch(/^thumbnails\/playlists\/c1\/[0-9a-f-]{36}$/)
        expect(files.getPresignedPutUrl).toHaveBeenCalledWith(
            expect.objectContaining({ key: out.key, contentType: 'image/jpeg' }),
        )
        expect(out.publicUrl).toBe(`https://s3/clubspace/${out.key}`)
    })

    it('refuses a course from another club', async () => {
        const { service } = setup(null)
        await expect(
            service.createThumbnailUpload({
                workspaceId: 'w1',
                playlistId: 'other',
                contentType: 'image/jpeg',
            }),
        ).rejects.toThrow('Курс не найден')
    })
})
