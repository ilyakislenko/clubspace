import { environment } from '../../environments/environment'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { CreatePlatformOrganizationFeature } from './create-organization.feature'
import { CreatePlatformOrganizationHandler } from './create-organization.handler'
import { ListPlatformOrganizationsFeature } from './list-organizations.feature'
import { ListPlatformOrganizationsHandler } from './list-organizations.handler'

const ORG_ROW = {
    id: 'org1',
    key: 'tomsk-bjj',
    name: 'Федерация БЖЖ',
    type: 'GRAPPLING',
    city: 'Томск',
    timezone: 'Asia/Tomsk',
    isDemo: false,
    isActive: true,
    createdAt: new Date('2026-11-26T00:00:00Z'),
    clubs: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'INVITED' }],
    _count: { members: 3 },
}

const build = () => {
    const prisma = {
        organization: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ id: 'org1' }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(ORG_ROW),
        },
        organizationMember: { create: jest.fn() },
        user: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'admin1' }),
        },
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma))
    const audit = { record: jest.fn() }
    const notifier = { notifyMemberAdded: jest.fn().mockResolvedValue(true) }
    return {
        prisma,
        audit,
        notifier,
        handler: new CreatePlatformOrganizationHandler(prisma as never, audit as never, notifier as never),
    }
}

const input = {
    name: 'Федерация БЖЖ',
    type: 'GRAPPLING' as const,
    city: 'Томск',
    adminEmail: 'Federation@Academy.demo',
}

describe('platform organizations', () => {
    const saved = environment.organizations.enabled
    beforeEach(() => {
        environment.organizations.enabled = true
    })
    afterAll(() => {
        environment.organizations.enabled = saved
    })

    it('refuses anyone but the platform admin', async () => {
        const { handler } = build()
        await expect(
            handler.execute(new CreatePlatformOrganizationFeature(input, 'u1', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('404s while the hub is off', async () => {
        environment.organizations.enabled = false
        const { handler } = build()
        await expect(
            handler.execute(new CreatePlatformOrganizationFeature(input, 'root', true)),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('creates the org with its first admin (account created by e-mail) and audits it', async () => {
        const t = build()
        const out = await t.handler.execute(new CreatePlatformOrganizationFeature(input, 'root', true))
        expect(t.prisma.user.create.mock.calls[0][0].data).toMatchObject({ email: 'federation@academy.demo' })
        expect(t.prisma.organization.create.mock.calls[0][0].data).toMatchObject({
            key: expect.stringMatching(/^[a-z0-9_-]{2,50}$/),
            name: 'Федерация БЖЖ',
            type: 'GRAPPLING',
            city: 'Томск',
        })
        expect(t.prisma.organizationMember.create.mock.calls[0][0].data).toEqual({
            organizationId: 'org1',
            userId: 'admin1',
            role: 'ORG_ADMIN',
            invitedById: 'root',
        })
        expect(t.notifier.notifyMemberAdded).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'admin1', role: 'ORG_ADMIN' }),
        )
        expect(t.audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'org.create', organizationId: 'org1' }),
        )
        expect(out).toEqual({
            organization: expect.objectContaining({ id: 'org1', activeClubs: 2, invitedClubs: 1, members: 3 }),
            adminCreated: true,
            adminNotified: true,
        })
    })

    it('reuses an existing account and refuses a taken explicit key', async () => {
        const t = build()
        t.prisma.user.findUnique.mockResolvedValue({ id: 'u9', status: 'ACTIVE' })
        const out = await t.handler.execute(
            new CreatePlatformOrganizationFeature({ ...input, key: 'tomsk-bjj' }, 'root', true),
        )
        expect(t.prisma.user.create).not.toHaveBeenCalled()
        expect(out.adminCreated).toBe(false)

        const taken = build()
        taken.prisma.organization.findUnique.mockResolvedValue({ id: 'other' })
        await expect(
            taken.handler.execute(new CreatePlatformOrganizationFeature({ ...input, key: 'tomsk-bjj' }, 'root', true)),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('suffixes a derived key past collisions', async () => {
        const t = build()
        t.prisma.organization.findMany.mockResolvedValue([{ key: 'tomsk' }])
        await t.handler.execute(new CreatePlatformOrganizationFeature({ ...input, name: 'Tomsk' }, 'root', true))
        expect(t.prisma.organization.create.mock.calls[0][0].data.key).not.toBe('tomsk')
    })

    it('lists every org with club and team counts (platform only)', async () => {
        const t = build()
        t.prisma.organization.findMany.mockResolvedValue([ORG_ROW])
        const list = new ListPlatformOrganizationsHandler(t.prisma as never)
        await expect(list.execute(new ListPlatformOrganizationsFeature('u1', false))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        const out = await list.execute(new ListPlatformOrganizationsFeature('root', true))
        expect(out.data[0]).toMatchObject({ key: 'tomsk-bjj', activeClubs: 2, invitedClubs: 1, members: 3 })
    })
})
