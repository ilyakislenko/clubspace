jest.mock('../../environments/environment', () => ({
    environment: { appUrl: 'https://app.club.example' },
}))

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { UpdateClubPublicProfileFeature } from './update-club-public-profile.feature'
import { UpdateClubPublicProfileHandler } from './update-club-public-profile.handler'

const OLD_LOGO = 'workspaces/w1/logo/0b8f7a52-7c5f-4c5e-9d1e-7f1a2b3c4d5e'
const NEW_LOGO = 'workspaces/w1/logo/1c9e8b63-8d6a-4d6f-8e2f-8a2b3c4d5e6f'

const CURRENT = {
    ownerId: 'owner',
    coachSeesAllGroups: false,
    id: 'w1',
    name: 'Академия БЖЖ',
    city: null as string | null,
    publicDescription: null as string | null,
    logoKey: null as string | null,
    isListed: false,
}

const build = (current: typeof CURRENT | null = CURRENT) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValueOnce(CURRENT)
                .mockResolvedValueOnce(current),
            // Echo what was written, so the response proves the write.
            update: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...CURRENT, ...current, ...data }),
            ),
        },
        workspacePublicSlug: {
            findUnique: jest.fn().mockResolvedValue({ slug: 'akademiya-bzhzh' }),
            update: jest.fn().mockResolvedValue({}),
        },
        workspaceJoinCode: {
            findUnique: jest.fn().mockResolvedValue({ code: 'ABCD2345' }),
        },
    }
    const record = jest.fn().mockResolvedValue(undefined)
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('bucket'),
        getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3/signed'),
        deleteObject: jest.fn().mockResolvedValue(undefined),
    }
    const handler = new UpdateClubPublicProfileHandler(
        prisma as never,
        new RbacService(prisma as never),
        { record } as never,
        files as never,
    )
    return { handler, prisma, record, files }
}

const payload = {
    slug: 'akademiya-bzhzh',
    city: 'Томск',
    description: 'Лучший зал',
    logoKey: null as string | null,
    isListed: true,
}

const run = (
    handler: UpdateClubPublicProfileHandler,
    body: Partial<typeof payload> = {},
    who: { userId: string; roleName: string | null } = {
        userId: 'admin1',
        roleName: 'admin',
    },
) =>
    handler.execute(
        new UpdateClubPublicProfileFeature(
            { ...payload, ...body },
            'w1',
            who.userId,
            who.roleName,
            false,
        ),
    )

describe('updateClubPublicProfile', () => {
    it.each(['coach', 'user'])(
        'refuses a %s and writes nothing',
        async (roleName) => {
            const { handler, prisma, record } = build()
            await expect(
                run(handler, {}, { userId: 'u1', roleName }),
            ).rejects.toBeInstanceOf(ForbiddenError)
            expect(prisma.workspace.update).not.toHaveBeenCalled()
            expect(record).not.toHaveBeenCalled()
        },
    )

    it('404s when the club is gone', async () => {
        const { handler, prisma } = build(null)
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.workspace.update).not.toHaveBeenCalled()
    })

    it('saves the profile and records it, keeping an unchanged slug', async () => {
        const { handler, prisma, record } = build()
        const out = await run(handler)
        expect(prisma.workspacePublicSlug.update).not.toHaveBeenCalled()
        expect(prisma.workspace.update.mock.calls[0][0].data).toEqual({
            city: 'Томск',
            publicDescription: 'Лучший зал',
            logoKey: null,
            isListed: true,
        })
        expect(record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.updatePublicProfile',
            workspaceId: 'w1',
            metadata: { slug: 'akademiya-bzhzh', isListed: true, hasLogo: false },
        })
        expect(out).toMatchObject({
            slug: 'akademiya-bzhzh',
            city: 'Томск',
            isListed: true,
            pageUrl: 'https://app.club.example/c/akademiya-bzhzh',
            joinPageUrl: 'https://app.club.example/join/ABCD2345',
        })
    })

    it('renames the slug', async () => {
        const { handler, prisma } = build()
        const out = await run(handler, { slug: 'gracie-tomsk' })
        expect(prisma.workspacePublicSlug.update.mock.calls[0][0]).toEqual({
            where: { workspaceId: 'w1' },
            data: { slug: 'gracie-tomsk' },
        })
        expect(out.slug).toBe('gracie-tomsk')
    })

    it('refuses a slug another club has, before saving anything', async () => {
        const { handler, prisma } = build()
        prisma.workspacePublicSlug.update.mockRejectedValue(
            Object.assign(new Error('unique'), { code: 'P2002' }),
        )
        await expect(
            run(handler, { slug: 'taken-slug' }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.workspace.update).not.toHaveBeenCalled()
    })

    it('rethrows an unrelated database error from the slug update', async () => {
        const { handler, prisma } = build()
        prisma.workspacePublicSlug.update.mockRejectedValue(new Error('db'))
        await expect(run(handler, { slug: 'other-slug' })).rejects.toThrow('db')
    })

    it.each([
        'workspaces/w2/logo/0b8f7a52-7c5f-4c5e-9d1e-7f1a2b3c4d5e',
        'workspaces/w1/logo/../../hls/master.m3u8',
        'hls/w1/master.m3u8',
    ])('refuses a logo key that is not this club’s upload: %s', async (logoKey) => {
        const { handler, prisma } = build()
        await expect(run(handler, { logoKey })).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.workspace.update).not.toHaveBeenCalled()
    })

    it('stores a new logo, signs it and deletes the replaced one', async () => {
        const { handler, files } = build({ ...CURRENT, logoKey: OLD_LOGO })
        const out = await run(handler, { logoKey: NEW_LOGO })
        expect(files.deleteObject).toHaveBeenCalledWith({
            bucket: 'bucket',
            key: OLD_LOGO,
        })
        expect(out.logoKey).toBe(NEW_LOGO)
        expect(out.logoUrl).toBe('https://s3/signed')
    })

    it('keeps the save when deleting the old logo fails', async () => {
        const { handler, files } = build({ ...CURRENT, logoKey: OLD_LOGO })
        files.deleteObject.mockRejectedValue(new Error('s3 down'))
        await expect(run(handler, { logoKey: null })).resolves.toMatchObject({
            logoKey: null,
            logoUrl: null,
        })
    })

    it('keeps an unchanged logo without deleting it', async () => {
        const { handler, files } = build({ ...CURRENT, logoKey: OLD_LOGO })
        await run(handler, { logoKey: OLD_LOGO })
        expect(files.deleteObject).not.toHaveBeenCalled()
    })
})
