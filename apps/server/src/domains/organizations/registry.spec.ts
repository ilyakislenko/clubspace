import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    loadRegistry,
    loadRegistryPerson,
    PERSON_KEY_RE,
    personKeyFor,
    registryBeltsFor,
    registryLadderIdsFor,
} from './registry'

const SECRET = 'test-secret'
const ORG = '11111111-1111-4111-8111-111111111111'
const CLUB = '22222222-2222-4222-8222-222222222222'

const raw = (o: Record<string, unknown> = {}) => ({
    userId: 'u-ivanov',
    workspaceId: CLUB,
    stripes: 2,
    awardedAt: new Date('2026-10-31T20:00:00Z'), // 01.11 in Tomsk
    firstname: 'Иван',
    lastname: 'Иванов',
    levelName: 'Синий пояс',
    levelColor: '#1e40af',
    ladderName: 'Пояса (взрослые)',
    templateLevelName: 'Синий',
    total: 1,
    // What the SQL must never be allowed to leak even if a column slipped in.
    email: 'ivanov@example.com',
    phone: '+79001234567',
    birthDate: new Date('2000-01-01'),
    awardedById: 'coach-1',
    ...o,
})

const prismaWith = (o: {
    links?: unknown[]
    consents?: Array<{ userId: string; dependentId: string | null }>
    rows?: unknown[]
}) => ({
    organizationClub: {
        findMany: jest.fn().mockResolvedValue(
            o.links ?? [
                {
                    workspaceId: CLUB,
                    workspace: { name: 'ACADEMY', timezone: 'Asia/Tomsk' },
                },
            ],
        ),
    },
    consentRecord: {
        findMany: jest
            .fn()
            .mockResolvedValue(o.consents ?? [{ userId: 'u-ivanov', dependentId: null }]),
    },
    guardianship: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue(o.rows ?? [raw()]),
})

const query = { curPage: 1, perPage: 50 }

describe('organization registry', () => {
    it('reads only ACTIVE clubs that share the registry', async () => {
        const prisma = prismaWith({})
        await loadRegistry(prisma as never, {
            organizationId: ORG,
            timezone: 'Asia/Tomsk',
            secret: SECRET,
            query,
        })
        expect(prisma.organizationClub.findMany.mock.calls[0][0].where).toEqual({
            organizationId: ORG,
            status: 'ACTIVE',
            shareRegistry: true,
        })
    })

    it('serializes name + belt + club + club-local date only', async () => {
        const prisma = prismaWith({})
        const out = await loadRegistry(prisma as never, {
            organizationId: ORG,
            timezone: 'Asia/Tomsk',
            secret: SECRET,
            query,
        })
        expect(out.total).toBe(1)
        expect(out.data).toEqual([
            {
                personKey: personKeyFor(SECRET, ORG, 'u-ivanov'),
                personName: 'Иван Иванов',
                levelName: 'Синий пояс',
                levelColor: '#1e40af',
                stripes: 2,
                ladderName: 'Пояса (взрослые)',
                clubId: CLUB,
                clubName: 'ACADEMY',
                awardedAt: '2026-11-01',
                templateLevelName: 'Синий',
            },
        ])
        expect(JSON.stringify(out)).not.toMatch(/u-ivanov|example\.com|7900|coach-1|2000-01-01/)
    })

    it('asks SQL for the latest promotion per person and ladder of consenting people in those clubs', async () => {
        const prisma = prismaWith({
            consents: [
                { userId: 'u-ivanov', dependentId: null },
                { userId: 'u-petrov', dependentId: null },
            ],
        })
        await loadRegistry(prisma as never, {
            organizationId: ORG,
            timezone: 'Asia/Tomsk',
            secret: SECRET,
            query: { ...query, q: 'Иван_%', awardedFrom: '2026-11-01', awardedTo: '2026-11-30' },
        })
        const sql = prisma.$queryRaw.mock.calls[0][0]
        expect(sql.sql).toContain('DISTINCT ON (p."userId", p."ladderId")')
        // Only ladders copied from this org's standards.
        expect(sql.sql).toContain('JOIN "OrganizationLadderTemplate" lt ON lt.id = l."templateId"')
        expect(sql.sql).toContain('lt."organizationId" = ')
        expect(sql.values).toContain(ORG)
        expect(sql.sql).toContain(`m.status = 'ACTIVE'`)
        expect(sql.sql).toContain('ILIKE')
        expect(sql.values).toEqual(
            expect.arrayContaining([
                [CLUB],
                ['u-ivanov', 'u-petrov'],
                '%Иван\\_\\%%',
                // 01.11 00:00 and 01.12 00:00 in Tomsk (UTC+7).
                new Date('2026-10-31T17:00:00Z'),
                new Date('2026-11-30T17:00:00Z'),
            ]),
        )
    })

    it('is empty without a sharing club, without consents, or for a club outside the filter', async () => {
        const noClubs = prismaWith({ links: [] })
        const noConsent = prismaWith({ consents: [] })
        const otherClub = prismaWith({})
        const p = { organizationId: ORG, timezone: 'Asia/Tomsk', secret: SECRET }
        await expect(loadRegistry(noClubs as never, { ...p, query })).resolves.toEqual({ data: [], total: 0 })
        await expect(loadRegistry(noConsent as never, { ...p, query })).resolves.toEqual({ data: [], total: 0 })
        await expect(
            loadRegistry(otherClub as never, {
                ...p,
                query: { ...query, clubId: '33333333-3333-4333-8333-333333333333' },
            }),
        ).resolves.toEqual({ data: [], total: 0 })
        expect(noConsent.$queryRaw).not.toHaveBeenCalled()
    })

    it('keys a person stably within an org and differently across orgs', () => {
        const a = personKeyFor(SECRET, ORG, 'u1')
        expect(a).toMatch(PERSON_KEY_RE)
        expect(personKeyFor(SECRET, ORG, 'u1')).toBe(a)
        expect(personKeyFor(SECRET, '99999999-9999-4999-8999-999999999999', 'u1')).not.toBe(a)
        expect(personKeyFor(SECRET, ORG, 'u2')).not.toBe(a)
    })

    it('opens the history of a consenting person by key, newest first', async () => {
        const prisma = prismaWith({
            rows: [raw(), raw({ levelName: 'Белый пояс', stripes: 4 })],
        })
        const key = personKeyFor(SECRET, ORG, 'u-ivanov')
        const out = await loadRegistryPerson(prisma as never, {
            organizationId: ORG,
            secret: SECRET,
            personKey: key,
        })
        expect(out.personName).toBe('Иван Иванов')
        expect(out.history.map((h) => h.levelName)).toEqual(['Синий пояс', 'Белый пояс'])
        expect(prisma.$queryRaw.mock.calls[0][0].sql).not.toContain('DISTINCT ON')
    })

    it('answers 404 for a malformed key, a withdrawn person or no visible belt', async () => {
        const p = { organizationId: ORG, secret: SECRET }
        await expect(
            loadRegistryPerson(prismaWith({}) as never, { ...p, personKey: 'nope' }),
        ).rejects.toBeInstanceOf(NotFoundError)
        await expect(
            loadRegistryPerson(prismaWith({ consents: [] }) as never, {
                ...p,
                personKey: personKeyFor(SECRET, ORG, 'u-ivanov'),
            }),
        ).rejects.toBeInstanceOf(NotFoundError)
        await expect(
            loadRegistryPerson(prismaWith({ rows: [] }) as never, {
                ...p,
                personKey: personKeyFor(SECRET, ORG, 'u-ivanov'),
            }),
        ).rejects.toBeInstanceOf(NotFoundError)
        await expect(
            loadRegistryPerson(prismaWith({ links: [] }) as never, {
                ...p,
                personKey: personKeyFor(SECRET, ORG, 'u-ivanov'),
            }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('gives the newest visible belt per person for event registrations', async () => {
        const prisma = prismaWith({
            consents: [{ userId: 'u-ivanov', dependentId: null }],
            rows: [raw(), raw({ levelName: 'Старый', ladderName: 'Другая' })],
        })
        const belts = await registryBeltsFor(prisma as never, ORG, ['u-ivanov', 'u-hidden'])
        expect([...belts.keys()]).toEqual(['u-ivanov'])
        expect(belts.get('u-ivanov')).toEqual({
            levelName: 'Синий пояс',
            levelColor: '#1e40af',
            stripes: 2,
            ladderName: 'Пояса (взрослые)',
        })
        await expect(registryBeltsFor(prisma as never, ORG, [])).resolves.toEqual(new Map())
        await expect(
            registryBeltsFor(prismaWith({ links: [] }) as never, ORG, ['u-ivanov']),
        ).resolves.toEqual(new Map())
        await expect(
            registryBeltsFor(prismaWith({ consents: [] }) as never, ORG, ['u-ivanov']),
        ).resolves.toEqual(new Map())
    })

    it("names the club's ladders on which the registry shows the person, gates included", async () => {
        const p = { organizationId: ORG, workspaceId: CLUB, userId: 'u-ivanov' }
        const prisma = prismaWith({ rows: [raw({ ladderId: 'lad-bjj' })] })
        await expect(registryLadderIdsFor(prisma as never, p)).resolves.toEqual(['lad-bjj'])
        expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual(
            expect.arrayContaining([[CLUB], ['u-ivanov'], ORG]),
        )
        // Another club than the sharing one, no consent: nothing, no query.
        const other = prismaWith({})
        await expect(
            registryLadderIdsFor(other as never, { ...p, workspaceId: '33333333-3333-4333-8333-333333333333' }),
        ).resolves.toEqual([])
        const noConsent = prismaWith({ consents: [] })
        await expect(registryLadderIdsFor(noConsent as never, p)).resolves.toEqual([])
        expect(other.$queryRaw).not.toHaveBeenCalled()
        expect(noConsent.$queryRaw).not.toHaveBeenCalled()
    })
})
