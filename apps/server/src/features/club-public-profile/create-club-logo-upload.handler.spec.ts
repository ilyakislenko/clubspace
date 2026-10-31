import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateClubLogoUploadFeature,
    CreateClubLogoUploadFeatureInputSchema,
} from './create-club-logo-upload.feature'
import { CreateClubLogoUploadHandler } from './create-club-logo-upload.handler'

const WORKSPACE = { ownerId: 'owner', coachSeesAllGroups: false, id: 'w1' }

const build = (workspace: typeof WORKSPACE | null = WORKSPACE) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValueOnce(WORKSPACE)
                .mockResolvedValueOnce(workspace),
        },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('bucket'),
        getPresignedPutUrl: jest
            .fn()
            .mockResolvedValue({ url: 'https://s3/put', method: 'PUT' }),
    }
    const handler = new CreateClubLogoUploadHandler(
        prisma as never,
        new RbacService(prisma as never),
        files as never,
    )
    return { handler, files }
}

const run = (
    handler: CreateClubLogoUploadHandler,
    who: { userId: string; roleName: string | null } = {
        userId: 'admin1',
        roleName: 'head_coach',
    },
) =>
    handler.execute(
        new CreateClubLogoUploadFeature(
            { contentType: 'image/png', contentLength: 1234 },
            'w1',
            who.userId,
            who.roleName,
            false,
        ),
    )

describe('createClubLogoUpload', () => {
    it.each(['coach', 'user'])('refuses a %s', async (roleName) => {
        const { handler, files } = build()
        await expect(
            run(handler, { userId: 'u1', roleName }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(files.getPresignedPutUrl).not.toHaveBeenCalled()
    })

    it('404s when the club is gone', async () => {
        const { handler } = build(null)
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('signs a size-bound upload under the club’s own logo prefix', async () => {
        const { handler, files } = build()
        const out = await run(handler)
        expect(out.key).toMatch(/^workspaces\/w1\/logo\/[0-9a-f-]{36}$/)
        expect(files.getPresignedPutUrl).toHaveBeenCalledWith({
            bucket: 'bucket',
            key: out.key,
            contentType: 'image/png',
            contentLength: 1234,
        })
        expect(out.upload).toEqual({ url: 'https://s3/put', method: 'PUT' })
    })
})

describe('CreateClubLogoUploadFeatureInputSchema', () => {
    it('refuses an SVG', () => {
        expect(
            CreateClubLogoUploadFeatureInputSchema.safeParse({
                contentType: 'image/svg+xml',
                contentLength: 10,
            }).success,
        ).toBe(false)
    })

    it('refuses a file over 2 MB', () => {
        expect(
            CreateClubLogoUploadFeatureInputSchema.safeParse({
                contentType: 'image/png',
                contentLength: 2 * 1024 * 1024 + 1,
            }).success,
        ).toBe(false)
    })
})
