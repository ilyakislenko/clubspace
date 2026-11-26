import { NotFoundError } from '../../../shared/errors/shared.errors'
import { ListMyClubOrganizationsFeature } from './list-my-club-organizations.feature'
import { ListMyClubOrganizationsHandler } from './list-my-club-organizations.handler'
import { SetMyOrganizationConsentFeature } from './set-my-organization-consent.feature'
import { SetMyOrganizationConsentHandler } from './set-my-organization-consent.handler'

const link = (o: Record<string, unknown> = {}) => ({
    allowMemberEvents: true,
    organization: { id: 'org1', name: 'Федерация БЖЖ', city: 'Томск' },
    ...o,
})

// org1 has this club sharing its registry, org2 doesn't.
const makePrisma = (o: { link?: unknown; consents?: unknown[]; podiums?: unknown[] } = {}) => ({
    organizationClub: {
        findFirst: jest.fn().mockResolvedValue(o.link === undefined ? link() : o.link),
        findMany: jest.fn(
            async ({ where }: { where: { organizationId?: string; shareRegistry?: boolean } }) =>
                where.shareRegistry
                    ? where.organizationId === 'org1'
                        ? [{ workspaceId: 'w1', workspace: { name: 'ACADEMY', timezone: 'Asia/Tomsk' } }]
                        : []
                    : [link(), link({ organization: { id: 'org2', name: 'Сеть', city: null } })],
        ),
    },
    consentRecord: {
        findMany: jest.fn().mockResolvedValue(o.consents ?? []),
        findFirst: jest.fn().mockResolvedValue({ acceptedAt: new Date('2026-11-26T10:00:00Z') }),
        create: jest.fn().mockResolvedValue({ id: 'c1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    guardianship: { findMany: jest.fn().mockResolvedValue([]) },
    // The registry's own read: the linked ladder with a visible belt.
    $queryRaw: jest.fn().mockResolvedValue([{ ladderId: 'lad-bjj' }]),
    // Published podiums (personPodiums).
    tournamentEntry: { findMany: jest.fn().mockResolvedValue(o.podiums ?? []) },
})

const setConsent = (
    prisma: ReturnType<typeof makePrisma>,
    granted: boolean,
    o: { userId?: string; guardianId?: string | null } = {},
) => {
    const realtime = { invalidateUsers: jest.fn() }
    return {
        realtime,
        result: new SetMyOrganizationConsentHandler(prisma as never, realtime as never).execute(
            new SetMyOrganizationConsentFeature(
                { granted },
                'w1',
                'org1',
                o.userId ?? 'adult',
                o.guardianId ?? null,
                '10.0.0.1',
                'jest',
            ),
        ),
    }
}

describe('setMyOrganizationConsent', () => {
    it('records the consent of a member for an ACTIVE org of the club', async () => {
        const prisma = makePrisma()
        const { result, realtime } = setConsent(prisma, true)
        await result
        expect(prisma.organizationClub.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            organizationId: 'org1',
            status: 'ACTIVE',
            organization: { isActive: true },
        })
        expect(prisma.consentRecord.create.mock.calls[0][0].data).toMatchObject({
            userId: 'adult',
            dependentId: null,
            organizationId: 'org1',
            kind: 'ORGANIZATION_SHARING',
            ip: '10.0.0.1',
            userAgent: 'jest',
        })
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(['adult'], ['organizations'])
    })

    it('acting as a child writes the guardian with dependentId', async () => {
        const prisma = makePrisma()
        const { result, realtime } = setConsent(prisma, true, {
            userId: 'kid',
            guardianId: 'parent',
        })
        await result
        expect(prisma.consentRecord.create.mock.calls[0][0].data).toMatchObject({
            userId: 'parent',
            dependentId: 'kid',
        })
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(['parent'], ['organizations'])
    })

    it('withdraws at once and reports the switch off', async () => {
        const prisma = makePrisma()
        const out = await setConsent(prisma, false).result
        expect(prisma.consentRecord.updateMany).toHaveBeenCalled()
        expect(out).toMatchObject({
            consentGranted: false,
            visibleInRegistry: false,
            registryLadderIds: [],
        })
        // No consent: the registry isn't even asked.
        expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('answers 404 for an org the club is not active in', async () => {
        await expect(setConsent(makePrisma({ link: null }), true).result).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })
})

describe('listMyClubOrganizations', () => {
    it("lists the club's active orgs with the member's consent and registry visibility", async () => {
        const prisma = makePrisma({ consents: [{ userId: 'adult', dependentId: null }] })
        const out = await new ListMyClubOrganizationsHandler(prisma as never).execute(
            new ListMyClubOrganizationsFeature('w1', 'adult', null),
        )
        expect(out.data).toHaveLength(2)
        expect(out.data[0]).toMatchObject({
            organizationId: 'org1',
            name: 'Федерация БЖЖ',
            consentGranted: true,
            consentGrantedAt: '2026-11-26T10:00:00.000Z',
            visibleInRegistry: true,
            registryLadderIds: ['lad-bjj'],
            eventsEnabled: true,
        })
        expect(out.data[0].consentText).toContain('«Федерация БЖЖ» моё имя и фамилию')
        // The second org doesn't get this club's registry: consent alone shows nothing.
        expect(out.data[1]).toMatchObject({
            consentGranted: true,
            visibleInRegistry: false,
            registryLadderIds: [],
        })
        // The registry was asked for this person in this club only.
        expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual(
            expect.arrayContaining([['w1'], ['adult'], 'org1']),
        )
        expect(prisma.organizationClub.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            status: 'ACTIVE',
            organization: { isActive: true },
        })
    })

    it("shows a guardian acting for a child the child's wording", async () => {
        const prisma = makePrisma()
        const out = await new ListMyClubOrganizationsHandler(prisma as never).execute(
            new ListMyClubOrganizationsFeature('w1', 'kid', 'parent'),
        )
        expect(out.data[0].consentText).toContain('имя и фамилию моего ребёнка')
        expect(out.data[0].consentText).not.toContain('моё имя')
    })

    it('flags an older consent edition as not current (tournaments need the new one)', async () => {
        const old = makePrisma({
            consents: [{ userId: 'adult', dependentId: null, version: '2026-11-26.2' }],
        })
        const outOld = await new ListMyClubOrganizationsHandler(old as never).execute(
            new ListMyClubOrganizationsFeature('w1', 'adult', null),
        )
        expect(outOld.data[0]).toMatchObject({ consentGranted: true, consentCurrent: false })
        const current = makePrisma({
            consents: [{ userId: 'adult', dependentId: null, version: '2026-11-27.1' }],
        })
        const outNew = await new ListMyClubOrganizationsHandler(current as never).execute(
            new ListMyClubOrganizationsFeature('w1', 'adult', null),
        )
        expect(outNew.data[0]).toMatchObject({ consentGranted: true, consentCurrent: true })
        expect(outNew.data[0].consentVersion).toBe('2026-11-27.1')
    })

    it('lists own published podiums even without a consent (own data)', async () => {
        const prisma = makePrisma({
            consents: [],
            podiums: [
                {
                    userId: 'kid',
                    place: 2,
                    division: { name: 'Мальчики · 8–9 лет · до 30 кг' },
                    tournament: {
                        event: {
                            id: 'ev-1',
                            title: 'Кубок федерации, 1-й этап',
                            startAt: new Date('2026-10-17T03:00:00Z'),
                            timezone: 'Asia/Tomsk',
                        },
                    },
                },
            ],
        })
        const out = await new ListMyClubOrganizationsHandler(prisma as never).execute(
            new ListMyClubOrganizationsFeature('w1', 'kid', 'parent'),
        )
        expect(out.data[0]).toMatchObject({ consentGranted: false, consentCurrent: false })
        expect(out.data[0].podiums).toEqual([
            {
                eventId: 'ev-1',
                tournamentTitle: 'Кубок федерации, 1-й этап',
                date: '2026-10-17',
                divisionName: 'Мальчики · 8–9 лет · до 30 кг',
                place: 2,
            },
        ])
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toMatchObject({
            userId: { in: ['kid'] },
            tournament: { status: 'FINISHED', resultsPublishedAt: { not: null } },
        })
    })
})
