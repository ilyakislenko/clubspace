jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))
// The store runs whole locked transactions; the fake below applies what it
// was asked to write so the handler's re-read sees the change.
jest.mock('../../../domains/tournaments/tournament-store', () => ({
    recordWeighIn: jest.fn(),
    moveEntry: jest.fn(),
    setEntryWithdrawn: jest.fn(),
}))

import { OrgRbacService } from '../../../domains/organizations/org-access'
import { moveEntry, recordWeighIn, setEntryWithdrawn } from '../../../domains/tournaments/tournament-store'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    ListTournamentEntriesFeature,
    MoveTournamentEntryFeature,
    RecordTournamentWeighInFeature,
    SetTournamentEntryWithdrawnFeature,
} from './entries.feature'
import { ListTournamentEntriesHandler } from './list-tournament-entries.handler'
import { MoveTournamentEntryHandler } from './move-tournament-entry.handler'
import { RecordTournamentWeighInHandler } from './record-tournament-weigh-in.handler'
import { SetTournamentEntryWithdrawnHandler } from './set-tournament-entry-withdrawn.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const CLUB = '22222222-2222-4222-8222-222222222222'
// A club that left the org: its people are hidden.
const GONE_CLUB = '33333333-3333-4333-8333-333333333333'
const T = 't1'
const OTHER_T = 't-other'
const D77 = 'd77'
const D82 = 'd82'
const DF_ABS = 'dfabs'
const DF_ADULT = 'dfadult'
const STAMP = new Date('2026-12-19T10:00:00Z')

type Role = 'ORG_ADMIN' | 'ORG_COACH' | null

const division = (id: string, o: Record<string, unknown>) => ({
    id,
    tournamentId: T,
    name: id,
    sortOrder: 0,
    sex: 'MALE',
    ageMin: 18,
    ageMax: 35,
    templateId: null,
    levelOrderFrom: null,
    levelOrderTo: null,
    levelLabel: null,
    weightMinG: null,
    weightMaxG: null,
    mat: null,
    matOrder: null,
    drawNo: 0,
    drawnAt: null,
    finishedAt: null,
    updatedAt: STAMP,
    ...o,
})

const DIVISIONS = [
    division(D77, { name: 'Мужчины · 18–35 лет · до 77 кг', weightMinG: 70000, weightMaxG: 77000 }),
    division(D82, { name: 'Мужчины · 18–35 лет · до 82 кг', weightMinG: 77000, weightMaxG: 82000, sortOrder: 1 }),
    division(DF_ABS, { name: 'Женщины · абсолютная', sex: 'FEMALE', ageMin: null, ageMax: null, sortOrder: 2 }),
    division(DF_ADULT, { name: 'Женщины · 18–35 лет · абсолютная', sex: 'FEMALE', sortOrder: 3 }),
]

type Row = ReturnType<typeof entry>
const entry = (id: string, lastname: string, firstname: string, o: Record<string, unknown> = {}) => ({
    id,
    tournamentId: T,
    userId: `u-${id}`,
    workspaceId: CLUB,
    status: 'CONFIRMED' as 'DECLARED' | 'CONFIRMED' | 'WITHDRAWN',
    sex: 'MALE' as 'MALE' | 'FEMALE',
    birthYear: 2000,
    declaredWeightG: null as number | null,
    weighedWeightG: null as number | null,
    weighedAt: null as Date | null,
    divisionId: null as string | null,
    templateLevelId: null as string | null,
    levelName: null as string | null,
    levelSetById: null as string | null,
    confirmedAt: STAMP as Date | null,
    withdrawnReason: null as string | null,
    place: null as number | null,
    updatedAt: STAMP,
    user: { firstname, lastname },
    workspace: { name: 'ACADEMY' },
    ...o,
})

// «Участники» of the tournament, out of order on purpose.
const roster = (): Row[] => [
    entry('e3', 'Сидоров', 'Семён', { divisionId: D77, weighedWeightG: 80000, weighedAt: STAMP }),
    entry('e1', 'Иванов', 'Иван', { divisionId: D77, weighedWeightG: 76000, weighedAt: STAMP }),
    // Hidden: no tournament-edition consent.
    entry('e7', 'Алексеев', 'Олег', { divisionId: D77, weighedWeightG: 75000, weighedAt: STAMP }),
    entry('e2', 'Петров', 'Пётр', { divisionId: D77 }),
    entry('e5', 'Борисов', 'Борис', { divisionId: D77, status: 'WITHDRAWN', withdrawnReason: 'Травма' }),
    // Hidden: the club left the org.
    entry('e8', 'Иванова', 'Мария', {
        workspaceId: GONE_CLUB,
        workspace: { name: 'GONE' },
        divisionId: D82,
        weighedWeightG: 79000,
        weighedAt: STAMP,
    }),
    entry('e6', 'Васильев', 'Василий', { divisionId: D82, status: 'DECLARED', declaredWeightG: 81000, confirmedAt: null }),
    entry('e4', 'Абрамов', 'Антон'),
]
const CONSENTED = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e8'].map((id) => `u-${id}`)

type Where = {
    tournamentId: string
    id?: { in: string[] }
    divisionId?: string
    place?: { not: null }
}

const makePrisma = (o: { role?: Role; rows?: Row[] } = {}) => {
    const rows = o.rows ?? roster()
    const tournaments = [
        { id: T, organizationId: ORG },
        { id: OTHER_T, organizationId: OTHER_ORG },
    ]
    const prisma = {
        rows,
        organization: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
        organizationMember: {
            findUnique: jest.fn().mockResolvedValue(o.role === null ? null : { role: o.role ?? 'ORG_COACH' }),
        },
        tournament: {
            findFirst: jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) => {
                const t = tournaments.find((x) => x.id === where.id && x.organizationId === where.organizationId)
                return t
                    ? {
                          ...t,
                          eventId: 'ev1',
                          organization: { type: 'GRAPPLING' },
                          status: 'WEIGH_IN',
                          matCount: 2,
                          resultsPublishedAt: null,
                          createdAt: STAMP,
                          updatedAt: STAMP,
                          event: {
                              title: 'Кубок',
                              startAt: new Date('2026-12-20T03:00:00Z'),
                              endAt: null,
                              timezone: 'Asia/Tomsk',
                              place: null,
                              registrationClosesAt: null,
                          },
                      }
                    : null
            }),
        },
        tournamentDivision: {
            findMany: jest.fn(async ({ where }: { where: { tournamentId: string } }) =>
                DIVISIONS.filter((d) => d.tournamentId === where.tournamentId),
            ),
        },
        tournamentEntry: {
            findMany: jest.fn(async ({ where }: { where: Where }) =>
                rows
                    .filter(
                        (r) =>
                            r.tournamentId === where.tournamentId &&
                            (!where.id || where.id.in.includes(r.id)) &&
                            (!where.divisionId || r.divisionId === where.divisionId),
                    )
                    .map((r) => ({ ...r })),
            ),
        },
        organizationClub: {
            findMany: jest.fn().mockResolvedValue([{ workspaceId: CLUB }]),
        },
        consentRecord: {
            findMany: jest.fn(async (_args: { where: Record<string, unknown> }) =>
                CONSENTED.map((userId) => ({ userId, dependentId: null, version: '2026-11-27.1' })),
            ),
        },
        guardianship: { findMany: jest.fn().mockResolvedValue([]) },
        organizationLadderTemplateLevel: { findMany: jest.fn().mockResolvedValue([]) },
    }
    return prisma
}
type Prisma = ReturnType<typeof makePrisma>
const rbac = (prisma: Prisma) => new OrgRbacService(prisma as never)
const audit = () => ({ record: jest.fn() })
const rowOf = (prisma: Prisma, id: string) => prisma.rows.find((r) => r.id === id)!

beforeEach(() => {
    jest.mocked(recordWeighIn).mockReset()
    jest.mocked(moveEntry).mockReset()
    jest.mocked(setEntryWithdrawn).mockReset()
})

// ─── listTournamentEntries ───────────────────────────────────────────────

describe('listTournamentEntries', () => {
    const list = (payload: Record<string, unknown>, o: { prisma?: Prisma; tournamentId?: string; superAdmin?: boolean } = {}) => {
        const prisma = o.prisma ?? makePrisma()
        return new ListTournamentEntriesHandler(prisma as never, rbac(prisma)).execute(
            new ListTournamentEntriesFeature(payload, ORG, o.tournamentId ?? T, 'coach', o.superAdmin ?? false),
        )
    }
    const ids = (out: { data: Array<{ id: string }> }) => out.data.map((r) => r.id)

    it('lists everyone but the withdrawn: visible by surname, hidden last, page defaults', async () => {
        const prisma = makePrisma()
        const out = await list({}, { prisma })
        expect(ids(out)).toEqual(['e4', 'e6', 'e1', 'e2', 'e3', 'e7', 'e8'])
        expect(out).toMatchObject({ total: 7, curPage: 1, perPage: 50 })
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toEqual({ tournamentId: T })
        expect(prisma.consentRecord.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG })
        expect(prisma.organizationClub.findMany.mock.calls[0][0].where).toEqual({
            organizationId: ORG,
            status: 'ACTIVE',
        })
        const byId = new Map(out.data.map((r) => [r.id, r]))
        expect(byId.get('e1')).toMatchObject({
            hidden: false,
            personName: 'Иван Иванов',
            clubId: CLUB,
            clubName: 'ACADEMY',
            weighedWeightKg: 76,
            divisionId: D77,
            divisionName: 'Мужчины · 18–35 лет · до 77 кг',
            fits: true,
        })
        expect(byId.get('e3')).toMatchObject({ fits: false, weighedWeightKg: 80 })
        // No weight, no division: nothing to compare.
        expect(byId.get('e2')!.fits).toBeNull()
        expect(byId.get('e4')).toMatchObject({ divisionId: null, divisionName: null, fits: null })
        expect(byId.get('e6')).toMatchObject({ status: 'DECLARED', declaredWeightKg: 81, fits: true })
    })

    it('shows hidden people as «Участник скрыт»: no name, club, sex, birth year, weights, fit or reason', async () => {
        const out = await list({ filter: 'all' })
        const byId = new Map(out.data.map((r) => [r.id, r]))
        const hidden = {
            hidden: true,
            personName: null,
            clubId: null,
            clubName: null,
            sex: null,
            birthYear: null,
            declaredWeightKg: null,
            weighedWeightKg: null,
            weighedAt: null,
            fits: null,
            withdrawnReason: null,
        }
        // No tournament-edition consent (weighed 75 in «до 77 кг» — would fit).
        expect(byId.get('e7')).toMatchObject({ ...hidden, status: 'CONFIRMED', divisionId: D77 })
        // Consented, but the club is no longer ACTIVE in the org.
        expect(byId.get('e8')).toMatchObject({ ...hidden, divisionId: D82 })
        // Visible rows keep everything.
        expect(byId.get('e3')).toMatchObject({
            sex: 'MALE',
            birthYear: 2000,
            weighedWeightKg: 80,
            weighedAt: STAMP.toISOString(),
            fits: false,
        })
    })

    it('hides a withdrawn person’s reason too', async () => {
        const rows = [
            ...roster(),
            entry('e10', 'Скрытов', 'Сергей', { divisionId: D77, status: 'WITHDRAWN', withdrawnReason: 'Травма' }),
        ]
        const out = await list({ filter: 'withdrawn' }, { prisma: makePrisma({ rows }) })
        expect(out.data.map((r) => [r.id, r.withdrawnReason])).toEqual([
            ['e5', 'Травма'],
            ['e10', null],
        ])
    })

    it('orders hidden people by entry id, never by surname', async () => {
        // Surnames А < Я, ids the other way round: the hidden order follows the ids.
        const rows = [
            entry('h2', 'Агеев', 'Антон', { divisionId: D77 }),
            entry('v1', 'Петров', 'Пётр', { divisionId: D77 }),
            entry('h1', 'Яковлев', 'Яков', { divisionId: D77 }),
            entry('v2', 'Андреев', 'Андрей', { divisionId: D77 }),
        ]
        const prisma = makePrisma({ rows })
        prisma.consentRecord.findMany.mockResolvedValue(
            ['u-v1', 'u-v2'].map((userId) => ({ userId, dependentId: null, version: '2026-11-27.1' })),
        )
        const out = await list({}, { prisma })
        expect(ids(out)).toEqual(['v2', 'v1', 'h1', 'h2'])
    })

    it('hides a person whose consent is of an older edition', async () => {
        const prisma = makePrisma()
        prisma.consentRecord.findMany.mockResolvedValue([
            { userId: 'u-e1', dependentId: null, version: '2026-11-26.2' },
        ])
        const out = await list({ q: 'иван' }, { prisma })
        expect(out.data).toEqual([])
    })

    it.each([
        ['unweighed', ['e4', 'e2']],
        ['offWeight', ['e3']],
        ['unassigned', ['e4']],
        ['withdrawn', ['e5']],
        ['declared', ['e6']],
        ['all', ['e4', 'e6', 'e1', 'e2', 'e3', 'e7', 'e8']],
    ])('filter %s', async (filter, expected) => {
        const out = await list({ filter })
        expect(ids(out)).toEqual(expected)
        expect(out.total).toBe(expected.length)
    })

    it('a search finds visible people only (a hidden namesake is not found)', async () => {
        const out = await list({ q: 'Иван' })
        // e8 «Иванова» is hidden (club left), so only Иван Иванов matches.
        expect(ids(out)).toEqual(['e1'])
        expect(ids(await list({ q: 'алексеев' }))).toEqual([])
        expect(ids(await list({ q: 'петр', filter: 'unweighed' }))).toEqual(['e2'])
    })

    it('narrows to a division', async () => {
        expect(ids(await list({ divisionId: D82 }))).toEqual(['e6', 'e8'])
    })

    it('pages after filtering', async () => {
        const out = await list({ curPage: 2, perPage: 2 })
        expect(ids(out)).toEqual(['e1', 'e2'])
        expect(out).toMatchObject({ total: 7, curPage: 2, perPage: 2 })
        const last = await list({ curPage: 4, perPage: 2 })
        expect(ids(last)).toEqual(['e8'])
        expect(ids(await list({ curPage: 5, perPage: 2 }))).toEqual([])
    })

    it('lets an org coach (staff) and an org admin read', async () => {
        await expect(list({}, { prisma: makePrisma({ role: 'ORG_COACH' }) })).resolves.toMatchObject({ total: 7 })
        await expect(list({}, { prisma: makePrisma({ role: 'ORG_ADMIN' }) })).resolves.toMatchObject({ total: 7 })
    })

    it('answers 404 to a non-member and reads nothing', async () => {
        const prisma = makePrisma({ role: null })
        await expect(list({}, { prisma })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournament.findFirst).not.toHaveBeenCalled()
        expect(prisma.tournamentEntry.findMany).not.toHaveBeenCalled()
    })

    it('lets the super admin in without a member row', async () => {
        const prisma = makePrisma({ role: null })
        await expect(list({}, { prisma, superAdmin: true })).resolves.toMatchObject({ total: 7 })
        expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's tournament", async () => {
        const prisma = makePrisma()
        await expect(list({}, { prisma, tournamentId: OTHER_T })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournament.findFirst.mock.calls[0][0].where).toEqual({ id: OTHER_T, organizationId: ORG })
        expect(prisma.tournamentEntry.findMany).not.toHaveBeenCalled()
    })
})

// ─── recordTournamentWeighIn ─────────────────────────────────────────────

// What recordWeighIn writes: the weight, the division it keeps or gets, and
// DECLARED → CONFIRMED by the weigher.
const fakeWeighIn = (prisma: Prisma) =>
    jest.mocked(recordWeighIn).mockImplementation(async (_tx, p) => {
        const r = rowOf(prisma, p.entryId)
        r.weighedWeightG = p.weighedWeightG
        r.weighedAt = p.now
        r.divisionId = r.divisionId ?? p.assignDivisionId
        if (r.status === 'DECLARED') {
            r.status = 'CONFIRMED'
            r.confirmedAt = p.now
        }
    })

describe('recordTournamentWeighIn', () => {
    const weigh = (
        entryId: string,
        weighedKg: number,
        o: { prisma?: Prisma; tournamentId?: string; superAdmin?: boolean; a?: ReturnType<typeof audit> } = {},
    ) => {
        const prisma = o.prisma ?? makePrisma()
        return new RecordTournamentWeighInHandler(prisma as never, rbac(prisma), (o.a ?? audit()) as never).execute(
            new RecordTournamentWeighInFeature({ weighedKg }, ORG, o.tournamentId ?? T, entryId, 'weigher', o.superAdmin ?? false),
        )
    }

    it('confirms a DECLARED entry by the weigher; the weight fits (grams from tenths of kg)', async () => {
        const prisma = makePrisma()
        fakeWeighIn(prisma)
        const a = audit()
        // Declared in «до 82 кг», weighed 81,9.
        const out = await weigh('e6', 81.9, { prisma, a })
        const args = jest.mocked(recordWeighIn).mock.calls[0][1]
        expect(jest.mocked(recordWeighIn).mock.calls[0][0]).toBe(prisma)
        expect(args).toEqual({
            tournamentId: T,
            entryId: 'e6',
            weighedWeightG: 81900,
            actorId: 'weigher',
            now: expect.any(Date),
            assignDivisionId: null,
        })
        expect(out).toEqual({
            entry: expect.objectContaining({
                id: 'e6',
                status: 'CONFIRMED',
                weighedWeightKg: 81.9,
                weighedAt: (args.now as Date).toISOString(),
                divisionId: D82,
                divisionName: 'Мужчины · 18–35 лет · до 82 кг',
                fits: true,
            }),
            fits: true,
            suggestedDivisionId: null,
            suggestedDivisionName: null,
        })
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.weighIn',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'weigher',
            metadata: { tournamentId: T, entryId: 'e6', divisionName: 'Мужчины · 18–35 лет · до 82 кг' },
        })
    })

    it('rounds the weight to 100 g', async () => {
        const prisma = makePrisma()
        fakeWeighIn(prisma)
        // 80.3 × 10 is 803.0000000000001 in floating point.
        await weigh('e2', 80.3, { prisma })
        expect(jest.mocked(recordWeighIn).mock.calls[0][1].weighedWeightG).toBe(80300)
        // The upper bound is inclusive: 77,0 fits «до 77 кг».
        const p2 = makePrisma()
        fakeWeighIn(p2)
        const out = await weigh('e2', 77, { prisma: p2 })
        expect(jest.mocked(recordWeighIn).mock.calls[1][1].weighedWeightG).toBe(77000)
        expect(out.fits).toBe(true)
    })

    it('off the division weight: fits=false and suggests the same-criteria division the weight fits', async () => {
        const prisma = makePrisma()
        fakeWeighIn(prisma)
        const a = audit()
        // Петров in «до 77 кг» weighs 80,3.
        const out = await weigh('e2', 80.3, { prisma, a })
        expect(jest.mocked(recordWeighIn).mock.calls[0][1].assignDivisionId).toBeNull()
        expect(out).toMatchObject({
            entry: { id: 'e2', divisionId: D77, weighedWeightKg: 80.3, fits: false },
            fits: false,
            suggestedDivisionId: D82,
            suggestedDivisionName: 'Мужчины · 18–35 лет · до 82 кг',
        })
        expect(a.record.mock.calls[0][0].metadata.divisionName).toBe('Мужчины · 18–35 лет · до 77 кг')
    })

    it('off weight with no division to move to: no suggestion', async () => {
        const prisma = makePrisma()
        fakeWeighIn(prisma)
        const out = await weigh('e2', 95, { prisma })
        expect(out).toMatchObject({ fits: false, suggestedDivisionId: null, suggestedDivisionName: null })
    })

    it('assigns the only fitting division to an entry without one', async () => {
        const prisma = makePrisma()
        fakeWeighIn(prisma)
        const a = audit()
        // Абрамов, born 2000, male, weighs 80 on 2026-12-20 → «до 82 кг» only.
        const out = await weigh('e4', 80, { prisma, a })
        expect(jest.mocked(recordWeighIn).mock.calls[0][1]).toMatchObject({
            entryId: 'e4',
            weighedWeightG: 80000,
            assignDivisionId: D82,
        })
        expect(out).toMatchObject({
            entry: { id: 'e4', divisionId: D82, divisionName: 'Мужчины · 18–35 лет · до 82 кг', fits: true },
            fits: true,
            suggestedDivisionId: null,
        })
        expect(a.record.mock.calls[0][0].metadata).toEqual({
            tournamentId: T,
            entryId: 'e4',
            divisionName: 'Мужчины · 18–35 лет · до 82 кг',
        })
    })

    it('leaves an entry without a division when several fit (assigned by hand)', async () => {
        // Consented, so the row shows the weight.
        const rows = [...roster(), entry('e9', 'Фёдорова', 'Анна', { sex: 'FEMALE' })]
        const prisma = makePrisma({ rows })
        prisma.consentRecord.findMany.mockResolvedValue(
            [...CONSENTED, 'u-e9'].map((userId) => ({ userId, dependentId: null, version: '2026-11-27.1' })),
        )
        fakeWeighIn(prisma)
        const a = audit()
        const out = await weigh('e9', 60, { prisma, a })
        expect(jest.mocked(recordWeighIn).mock.calls[0][1].assignDivisionId).toBeNull()
        expect(out).toMatchObject({
            entry: { id: 'e9', divisionId: null, divisionName: null, fits: null, weighedWeightKg: 60 },
            fits: false,
            suggestedDivisionId: null,
            suggestedDivisionName: null,
        })
        expect(a.record.mock.calls[0][0].metadata.divisionName).toBeNull()
    })

    it('weighs a hidden entry: the answer says whether it fits, the row hides the weight', async () => {
        const prisma = makePrisma()
        fakeWeighIn(prisma)
        // Алексеев (no consent) in «до 77 кг» weighs 80.
        const out = await weigh('e7', 80, { prisma })
        expect(jest.mocked(recordWeighIn).mock.calls[0][1]).toMatchObject({ entryId: 'e7', weighedWeightG: 80000 })
        expect(out).toMatchObject({
            entry: { id: 'e7', hidden: true, weighedWeightKg: null, fits: null, divisionId: D77 },
            fits: false,
            suggestedDivisionId: D82,
        })
    })

    it('does not reassign an entry that already has a division', async () => {
        const prisma = makePrisma()
        fakeWeighIn(prisma)
        // Иванов is in «до 77 кг»; a weight that would match «до 82 кг» does not move him.
        await weigh('e1', 80, { prisma })
        expect(jest.mocked(recordWeighIn).mock.calls[0][1].assignDivisionId).toBeNull()
        expect(rowOf(prisma, 'e1').divisionId).toBe(D77)
    })

    it('answers 404 for an entry not in this tournament and writes nothing', async () => {
        const rows = [...roster(), entry('x1', 'Чужой', 'Иван', { tournamentId: OTHER_T })]
        const prisma = makePrisma({ rows })
        const a = audit()
        await expect(weigh('x1', 80, { prisma, a })).rejects.toBeInstanceOf(NotFoundError)
        await expect(weigh('missing', 80, { prisma, a })).rejects.toBeInstanceOf(NotFoundError)
        expect(recordWeighIn).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's tournament", async () => {
        const a = audit()
        await expect(weigh('e1', 80, { tournamentId: OTHER_T, a })).rejects.toBeInstanceOf(NotFoundError)
        expect(recordWeighIn).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('answers 404 to a non-member', async () => {
        const prisma = makePrisma({ role: null })
        await expect(weigh('e1', 80, { prisma })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournament.findFirst).not.toHaveBeenCalled()
        expect(recordWeighIn).not.toHaveBeenCalled()
    })

    it('lets an org coach and the super admin weigh', async () => {
        const coach = makePrisma({ role: 'ORG_COACH' })
        fakeWeighIn(coach)
        await expect(weigh('e1', 76, { prisma: coach })).resolves.toMatchObject({ fits: true })
        const admin = makePrisma({ role: null })
        fakeWeighIn(admin)
        await expect(weigh('e1', 76, { prisma: admin, superAdmin: true })).resolves.toMatchObject({ fits: true })
        expect(admin.organizationMember.findUnique).not.toHaveBeenCalled()
    })
})

// ─── moveTournamentEntry ─────────────────────────────────────────────────

const fakeMove = (prisma: Prisma) =>
    jest.mocked(moveEntry).mockImplementation(async (_tx, p) => {
        const r = rowOf(prisma, p.entryId)
        const fromDivisionId = r.divisionId
        r.divisionId = p.toDivisionId
        return { fromDivisionId, cleared: fromDivisionId !== p.toDivisionId }
    })

describe('moveTournamentEntry', () => {
    const move = (
        entryId: string,
        divisionId: string,
        o: { prisma?: Prisma; tournamentId?: string; superAdmin?: boolean; a?: ReturnType<typeof audit> } = {},
    ) => {
        const prisma = o.prisma ?? makePrisma()
        return new MoveTournamentEntryHandler(prisma as never, rbac(prisma), (o.a ?? audit()) as never).execute(
            new MoveTournamentEntryFeature({ divisionId }, ORG, o.tournamentId ?? T, entryId, 'coach', o.superAdmin ?? false),
        )
    }

    it('moves an off-weight entry, audits both divisions by name', async () => {
        const prisma = makePrisma()
        fakeMove(prisma)
        const a = audit()
        // Сидоров weighed 80 in «до 77 кг» → «до 82 кг».
        const out = await move('e3', D82, { prisma, a })
        expect(jest.mocked(moveEntry).mock.calls[0]).toEqual([
            prisma,
            { tournamentId: T, entryId: 'e3', toDivisionId: D82 },
        ])
        expect(out).toMatchObject({
            id: 'e3',
            divisionId: D82,
            divisionName: 'Мужчины · 18–35 лет · до 82 кг',
            fits: true,
        })
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.entryMove',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'coach',
            metadata: {
                tournamentId: T,
                entryId: 'e3',
                fromDivisionId: D77,
                toDivisionId: D82,
                fromDivisionName: 'Мужчины · 18–35 лет · до 77 кг',
                toDivisionName: 'Мужчины · 18–35 лет · до 82 кг',
            },
        })
    })

    it('assigns an entry without a division (from = null)', async () => {
        const prisma = makePrisma()
        fakeMove(prisma)
        const a = audit()
        const out = await move('e4', D77, { prisma, a })
        expect(out).toMatchObject({ id: 'e4', divisionId: D77, fits: null })
        expect(a.record.mock.calls[0][0].metadata).toMatchObject({
            fromDivisionId: null,
            fromDivisionName: null,
            toDivisionId: D77,
            toDivisionName: 'Мужчины · 18–35 лет · до 77 кг',
        })
    })

    it('a move to the same division changes nothing and is not audited', async () => {
        const prisma = makePrisma()
        fakeMove(prisma)
        const a = audit()
        const out = await move('e1', D77, { prisma, a })
        expect(out).toMatchObject({ id: 'e1', divisionId: D77, fits: true })
        expect(a.record).not.toHaveBeenCalled()
    })

    it('passes the store refusal on (entry or division of another tournament), no audit', async () => {
        jest.mocked(moveEntry).mockRejectedValue(new NotFoundError({ message: 'Категория не найдена' }))
        const a = audit()
        await expect(move('e1', 'd-elsewhere', { a })).rejects.toBeInstanceOf(NotFoundError)
        expect(a.record).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's tournament", async () => {
        const a = audit()
        await expect(move('e1', D82, { tournamentId: OTHER_T, a })).rejects.toBeInstanceOf(NotFoundError)
        expect(moveEntry).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('answers 404 to a non-member', async () => {
        const prisma = makePrisma({ role: null })
        await expect(move('e1', D82, { prisma })).rejects.toBeInstanceOf(NotFoundError)
        expect(moveEntry).not.toHaveBeenCalled()
    })

    it('lets an org coach and the super admin move', async () => {
        const coach = makePrisma({ role: 'ORG_COACH' })
        fakeMove(coach)
        await expect(move('e3', D82, { prisma: coach })).resolves.toMatchObject({ divisionId: D82 })
        const admin = makePrisma({ role: null })
        fakeMove(admin)
        await expect(move('e3', D82, { prisma: admin, superAdmin: true })).resolves.toMatchObject({ divisionId: D82 })
    })
})

// ─── setTournamentEntryWithdrawn ─────────────────────────────────────────

const fakeWithdraw = (prisma: Prisma) =>
    jest.mocked(setEntryWithdrawn).mockImplementation(async (_tx, p) => {
        const r = rowOf(prisma, p.entryId)
        r.status = p.withdrawn ? 'WITHDRAWN' : 'CONFIRMED'
        r.withdrawnReason = p.reason
    })

describe('setTournamentEntryWithdrawn', () => {
    const run = (
        entryId: string,
        payload: { withdrawn: boolean; reason?: string },
        o: { prisma?: Prisma; tournamentId?: string; superAdmin?: boolean; a?: ReturnType<typeof audit> } = {},
    ) => {
        const prisma = o.prisma ?? makePrisma()
        return new SetTournamentEntryWithdrawnHandler(prisma as never, rbac(prisma), (o.a ?? audit()) as never).execute(
            new SetTournamentEntryWithdrawnFeature(payload, ORG, o.tournamentId ?? T, entryId, 'coach', o.superAdmin ?? false),
        )
    }

    it('withdraws with the given reason, audited with the division', async () => {
        const prisma = makePrisma()
        fakeWithdraw(prisma)
        const a = audit()
        const out = await run('e1', { withdrawn: true, reason: 'Травма колена' }, { prisma, a })
        expect(jest.mocked(setEntryWithdrawn).mock.calls[0]).toEqual([
            prisma,
            { tournamentId: T, entryId: 'e1', withdrawn: true, reason: 'Травма колена' },
        ])
        expect(out).toMatchObject({ id: 'e1', status: 'WITHDRAWN', withdrawnReason: 'Травма колена', divisionId: D77 })
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.entryWithdraw',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'coach',
            metadata: {
                tournamentId: T,
                entryId: 'e1',
                withdrawn: true,
                // Whether a reason was typed, never its text.
                reasonGiven: true,
                divisionName: 'Мужчины · 18–35 лет · до 77 кг',
            },
        })
    })

    it('defaults the reason to «Снят секретарём»', async () => {
        const prisma = makePrisma()
        fakeWithdraw(prisma)
        const a = audit()
        const out = await run('e2', { withdrawn: true }, { prisma, a })
        expect(jest.mocked(setEntryWithdrawn).mock.calls[0][1].reason).toBe('Снят секретарём')
        expect(out.withdrawnReason).toBe('Снят секретарём')
        expect(a.record.mock.calls[0][0].metadata).toMatchObject({ withdrawn: true, reasonGiven: false })
        expect(a.record.mock.calls[0][0].metadata).not.toHaveProperty('reason')
    })

    it('returns an entry: no reason, audited as withdrawn=false', async () => {
        const prisma = makePrisma()
        fakeWithdraw(prisma)
        const a = audit()
        const out = await run('e5', { withdrawn: false, reason: 'ignored' }, { prisma, a })
        expect(jest.mocked(setEntryWithdrawn).mock.calls[0][1]).toEqual({
            tournamentId: T,
            entryId: 'e5',
            withdrawn: false,
            reason: null,
        })
        expect(out).toMatchObject({ id: 'e5', status: 'CONFIRMED', withdrawnReason: null })
        expect(a.record.mock.calls[0][0].metadata).toMatchObject({ withdrawn: false, reasonGiven: false })
        expect(a.record.mock.calls[0][0].metadata).not.toHaveProperty('reason')
    })

    it('withdraws an entry without a division (divisionName null)', async () => {
        const prisma = makePrisma()
        fakeWithdraw(prisma)
        const a = audit()
        const out = await run('e4', { withdrawn: true }, { prisma, a })
        expect(out).toMatchObject({ divisionId: null, divisionName: null, fits: null })
        expect(a.record.mock.calls[0][0].metadata.divisionName).toBeNull()
    })

    it('passes the store refusal on (entry of another tournament), no audit', async () => {
        jest.mocked(setEntryWithdrawn).mockRejectedValue(new NotFoundError({ message: 'Участник не найден' }))
        const a = audit()
        await expect(run('x1', { withdrawn: true }, { a })).rejects.toBeInstanceOf(NotFoundError)
        expect(a.record).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's tournament", async () => {
        const a = audit()
        await expect(run('e1', { withdrawn: true }, { tournamentId: OTHER_T, a })).rejects.toBeInstanceOf(NotFoundError)
        expect(setEntryWithdrawn).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('answers 404 to a non-member', async () => {
        const prisma = makePrisma({ role: null })
        await expect(run('e1', { withdrawn: true }, { prisma })).rejects.toBeInstanceOf(NotFoundError)
        expect(setEntryWithdrawn).not.toHaveBeenCalled()
    })

    it('lets an org coach and the super admin withdraw', async () => {
        const coach = makePrisma({ role: 'ORG_COACH' })
        fakeWithdraw(coach)
        await expect(run('e1', { withdrawn: true }, { prisma: coach })).resolves.toMatchObject({ status: 'WITHDRAWN' })
        const admin = makePrisma({ role: null })
        fakeWithdraw(admin)
        await expect(run('e1', { withdrawn: true }, { prisma: admin, superAdmin: true })).resolves.toMatchObject({
            status: 'WITHDRAWN',
        })
        expect(admin.organizationMember.findUnique).not.toHaveBeenCalled()
    })
})
