import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetPublicClubFeature } from './get-public-club.feature'
import { GetPublicClubHandler } from './get-public-club.handler'

const TODAY = new Date('2026-11-01T00:00:00.000Z')

const club = (overrides: Record<string, unknown> = {}) => ({
    name: 'Академия БЖЖ',
    type: 'GRAPPLING',
    city: 'Томск',
    publicDescription: 'Зал у реки',
    logoKey: null as string | null,
    isListed: false,
    isActive: true,
    scheduleEnabled: true,
    timezone: 'Asia/Tomsk',
    aboutContacts: [{ label: 'Тренер', phone: '+79528849420' }],
    aboutLinks: [
        { label: 'Сайт', url: 'https://club.example' },
        { label: 'Плохая', url: 'javascript:alert(1)' },
    ],
    aboutRules: 'Не опаздывать',
    aboutUpdatedAt: null,
    publicSlugRow: { slug: 'akademiya-bzhzh' },
    joinCodeRow: { code: 'ABCD2345' },
    gyms: [{ name: 'Манеж', address: 'ул. Ленина, 1' }],
    groups: [
        {
            name: 'Взрослые',
            gym: { name: 'Манеж', timezone: null },
            slots: [{ dayOfWeek: 1, startTime: '19:00', durationMin: 90 }],
        },
        {
            name: 'Дети',
            gym: { name: 'Манеж', timezone: 'Asia/Novosibirsk' },
            slots: [{ dayOfWeek: 2, startTime: '17:00', durationMin: 60 }],
        },
        { name: 'Пустая', gym: null, slots: [] },
    ],
    ...overrides,
})

const build = () => {
    const prisma = {
        workspaceJoinCode: { findUnique: jest.fn() },
        workspacePublicSlug: { findUnique: jest.fn() },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('bucket'),
        getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3/logo'),
    }
    const handler = new GetPublicClubHandler(prisma as never, files as never)
    return { handler, prisma, files }
}

const byCode = (handler: GetPublicClubHandler, code: string) =>
    handler.execute(new GetPublicClubFeature({ kind: 'code', code }, TODAY))
const bySlug = (handler: GetPublicClubHandler, slug: string) =>
    handler.execute(new GetPublicClubFeature({ kind: 'slug', slug }, TODAY))

describe('getPublicClubByCode', () => {
    it('404s on a malformed code without touching the database', async () => {
        const { handler, prisma } = build()
        await expect(byCode(handler, 'nope')).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.workspaceJoinCode.findUnique).not.toHaveBeenCalled()
    })

    it('404s on an unknown code', async () => {
        const { handler, prisma } = build()
        prisma.workspaceJoinCode.findUnique.mockResolvedValue(null)
        await expect(byCode(handler, 'ABCD2345')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('404s for a deactivated club', async () => {
        const { handler, prisma } = build()
        prisma.workspaceJoinCode.findUnique.mockResolvedValue({
            workspace: club({ isActive: false }),
        })
        await expect(byCode(handler, 'ABCD2345')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('previews an unlisted club: safe fields only, no public address', async () => {
        const { handler, prisma, files } = build()
        prisma.workspaceJoinCode.findUnique.mockResolvedValue({
            workspace: club(),
        })
        const out = await byCode(handler, 'abcd-2345')
        expect(prisma.workspaceJoinCode.findUnique.mock.calls[0][0].where).toEqual(
            { code: 'ABCD2345' },
        )
        expect(out).toEqual({
            name: 'Академия БЖЖ',
            type: 'GRAPPLING',
            slug: null,
            logoUrl: null,
            description: 'Зал у реки',
            city: 'Томск',
            gyms: [{ name: 'Манеж', address: 'ул. Ленина, 1' }],
            schedule: [
                {
                    group: 'Взрослые',
                    gym: 'Манеж',
                    timezone: 'Asia/Tomsk',
                    slots: [{ dayOfWeek: 1, startTime: '19:00', durationMin: 90 }],
                },
                {
                    group: 'Дети',
                    gym: 'Манеж',
                    timezone: 'Asia/Novosibirsk',
                    slots: [{ dayOfWeek: 2, startTime: '17:00', durationMin: 60 }],
                },
            ],
            contacts: [{ label: 'Тренер', phone: '+79528849420' }],
            links: [{ label: 'Сайт', url: 'https://club.example' }],
            joinCode: 'ABCD2345',
            joinCodeDisplay: 'ABCD-2345',
        })
        expect(files.getPresignedGetUrl).not.toHaveBeenCalled()
    })

    it('names the public address of a listed club and signs its logo', async () => {
        const { handler, prisma } = build()
        prisma.workspaceJoinCode.findUnique.mockResolvedValue({
            workspace: club({ isListed: true, logoKey: 'workspaces/w1/logo/x' }),
        })
        const out = await byCode(handler, 'ABCD2345')
        expect(out.slug).toBe('akademiya-bzhzh')
        expect(out.logoUrl).toBe('https://s3/logo')
    })

    it('hides the schedule when the club switched its schedule section off', async () => {
        const { handler, prisma } = build()
        prisma.workspaceJoinCode.findUnique.mockResolvedValue({
            workspace: club({ scheduleEnabled: false }),
        })
        expect((await byCode(handler, 'ABCD2345')).schedule).toEqual([])
    })

    it('asks only for the slots in force today', async () => {
        const { handler, prisma } = build()
        prisma.workspaceJoinCode.findUnique.mockResolvedValue({
            workspace: club(),
        })
        await byCode(handler, 'ABCD2345')
        const select =
            prisma.workspaceJoinCode.findUnique.mock.calls[0][0].select
                .workspace.select
        expect(select.groups.select.slots.where).toEqual({
            AND: [
                { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: TODAY } }] },
                {
                    OR: [
                        { effectiveUntil: null },
                        { effectiveUntil: { gte: TODAY } },
                    ],
                },
            ],
        })
        // Never a member, a coach or an id.
        expect(select).not.toHaveProperty('members')
        expect(select).not.toHaveProperty('id')
        expect(select.groups.select).not.toHaveProperty('coach')
    })
})

describe('getPublicClubBySlug', () => {
    it('404s on an invalid slug without touching the database', async () => {
        const { handler, prisma } = build()
        await expect(bySlug(handler, '../etc')).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.workspacePublicSlug.findUnique).not.toHaveBeenCalled()
    })

    it('404s on an unknown slug', async () => {
        const { handler, prisma } = build()
        prisma.workspacePublicSlug.findUnique.mockResolvedValue(null)
        await expect(bySlug(handler, 'nope-club')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('404s for an unlisted club', async () => {
        const { handler, prisma } = build()
        prisma.workspacePublicSlug.findUnique.mockResolvedValue({
            workspace: club({ isListed: false }),
        })
        await expect(
            bySlug(handler, 'akademiya-bzhzh'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s for a deactivated listed club', async () => {
        const { handler, prisma } = build()
        prisma.workspacePublicSlug.findUnique.mockResolvedValue({
            workspace: club({ isListed: true, isActive: false }),
        })
        await expect(
            bySlug(handler, 'akademiya-bzhzh'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('shows a listed club with its join code, whatever the case of the slug', async () => {
        const { handler, prisma } = build()
        prisma.workspacePublicSlug.findUnique.mockResolvedValue({
            workspace: club({ isListed: true }),
        })
        const out = await bySlug(handler, 'Akademiya-BZHZH')
        expect(prisma.workspacePublicSlug.findUnique.mock.calls[0][0].where).toEqual(
            { slug: 'akademiya-bzhzh' },
        )
        expect(out.slug).toBe('akademiya-bzhzh')
        expect(out.joinCode).toBe('ABCD2345')
        expect(out.joinCodeDisplay).toBe('ABCD-2345')
    })

    it('has no join code when the club never had one', async () => {
        const { handler, prisma } = build()
        prisma.workspacePublicSlug.findUnique.mockResolvedValue({
            workspace: club({ isListed: true, joinCodeRow: null }),
        })
        const out = await bySlug(handler, 'akademiya-bzhzh')
        expect(out.joinCode).toBeNull()
        expect(out.joinCodeDisplay).toBeNull()
    })
})
