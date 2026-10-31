jest.mock('../../environments/environment', () => ({
    environment: { appUrl: 'https://app.club.example' },
}))

import { environment } from '../../environments/environment'
import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { GetClubPublicProfileFeature } from './get-club-public-profile.feature'
import { GetClubPublicProfileHandler } from './get-club-public-profile.handler'

const WORKSPACE = {
    ownerId: 'owner',
    coachSeesAllGroups: false,
    id: 'w1',
    name: 'Академия БЖЖ',
    city: 'Томск',
    publicDescription: 'Лучший зал',
    logoKey: null as string | null,
    isListed: false,
}

const build = (workspace: typeof WORKSPACE | null = WORKSPACE) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                // RbacService reads the owner first, the handler second.
                .mockResolvedValueOnce(WORKSPACE)
                .mockResolvedValueOnce(workspace),
        },
        workspacePublicSlug: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
        },
        workspaceJoinCode: {
            findUnique: jest.fn().mockResolvedValue({ code: 'ABCD2345' }),
        },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('bucket'),
        getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3/signed'),
    }
    const handler = new GetClubPublicProfileHandler(
        prisma as never,
        new RbacService(prisma as never),
        files as never,
    )
    return { handler, prisma, files }
}

const run = (
    handler: GetClubPublicProfileHandler,
    who: { userId: string; roleName: string | null } = {
        userId: 'admin1',
        roleName: 'admin',
    },
) =>
    handler.execute(
        new GetClubPublicProfileFeature('w1', who.userId, who.roleName, false),
    )

describe('getClubPublicProfile', () => {
    it.each(['coach', 'user'])('refuses a %s', async (roleName) => {
        const { handler, prisma } = build()
        await expect(
            run(handler, { userId: 'u1', roleName }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspacePublicSlug.create).not.toHaveBeenCalled()
    })

    it('lets the owner without a member row in', async () => {
        const { handler } = build()
        await expect(
            run(handler, { userId: 'owner', roleName: null }),
        ).resolves.toMatchObject({ slug: 'akademiya-bzhzh' })
    })

    it('404s when the club is gone', async () => {
        const { handler } = build(null)
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('assigns the slug on first view and builds the preview links', async () => {
        const { handler, prisma, files } = build()
        const out = await run(handler)
        expect(prisma.workspacePublicSlug.create.mock.calls[0][0].data).toEqual(
            { workspaceId: 'w1', slug: 'akademiya-bzhzh' },
        )
        expect(out).toEqual({
            slug: 'akademiya-bzhzh',
            city: 'Томск',
            description: 'Лучший зал',
            logoKey: null,
            logoUrl: null,
            isListed: false,
            pageUrl: 'https://app.club.example/c/akademiya-bzhzh',
            joinPageUrl: 'https://app.club.example/join/ABCD2345',
        })
        expect(files.getPresignedGetUrl).not.toHaveBeenCalled()
    })

    it('signs the logo when there is one', async () => {
        const key = 'workspaces/w1/logo/0b8f7a52-7c5f-4c5e-9d1e-7f1a2b3c4d5e'
        const { handler, files } = build({ ...WORKSPACE, logoKey: key })
        const out = await run(handler)
        expect(out.logoUrl).toBe('https://s3/signed')
        expect(files.getPresignedGetUrl.mock.calls[0][0]).toMatchObject({
            bucket: 'bucket',
            key,
        })
    })

    it('leaves the links out when APP_URL is not configured', async () => {
        const saved = environment.appUrl
        Object.assign(environment, { appUrl: null })
        try {
            const { handler } = build()
            const out = await run(handler)
            expect(out.pageUrl).toBeNull()
            expect(out.joinPageUrl).toBeNull()
        } finally {
            Object.assign(environment, { appUrl: saved })
        }
    })
})
