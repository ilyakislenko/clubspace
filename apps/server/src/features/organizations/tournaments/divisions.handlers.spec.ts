jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))

import { OrgRbacService } from '../../../domains/organizations/org-access'
import { TournamentPublishedError } from '../../../domains/tournaments/tournament-errors'
import { NotFoundError, BadRequestError, StaleUpdateError } from '../../../shared/errors/shared.errors'
import { AssignTournamentMatsHandler } from './assign-tournament-mats.handler'
import { CopyTournamentDivisionsHandler } from './copy-tournament-divisions.handler'
import { CreateTournamentDivisionsHandler } from './create-tournament-divisions.handler'
import { DeleteTournamentDivisionHandler } from './delete-tournament-division.handler'
import {
    AssignTournamentMatsFeature,
    CopyTournamentDivisionsFeature,
    CreateTournamentDivisionsFeature,
    CreateTournamentDivisionsInputSchema,
    DeleteTournamentDivisionFeature,
    ListTournamentDivisionsFeature,
    UpdateTournamentDivisionFeature,
} from './divisions.feature'
import { ListTournamentDivisionsHandler } from './list-tournament-divisions.handler'
import { UpdateTournamentDivisionHandler } from './update-tournament-division.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const T = '33333333-3333-4333-8333-333333333333'
// Another tournament of the same org (the copy source).
const FROM = '55555555-5555-4555-8555-555555555555'
// A tournament id of another org: the scoped lookup never matches it.
const FOREIGN = '44444444-4444-4444-8444-444444444444'
const TPL = '66666666-6666-4666-8666-666666666666'
const FOREIGN_TPL = '77777777-7777-4777-8777-777777777777'
const UPDATED_AT = new Date('2026-11-25T00:00:00Z')

type Status = 'SETUP' | 'WEIGH_IN' | 'RUNNING' | 'FINISHED'
type Div = {
    id: string
    tournamentId: string
    name: string
    sortOrder: number
    sex: 'FEMALE' | 'MALE' | null
    ageMin: number | null
    ageMax: number | null
    templateId: string | null
    levelOrderFrom: number | null
    levelOrderTo: number | null
    levelLabel: string | null
    weightMinG: number | null
    weightMaxG: number | null
    mat: number | null
    matOrder: number | null
    drawNo: number
    drawnAt: Date | null
    finishedAt: Date | null
    updatedAt: Date
}
const div = (o: Partial<Div> & Pick<Div, 'id'>): Div => ({
    tournamentId: T,
    name: 'Абсолютная',
    sortOrder: 1,
    sex: null,
    ageMin: null,
    ageMax: null,
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
    updatedAt: UPDATED_AT,
    ...o,
})
// Auto-named (equals the generator's name for its criteria).
const D1 = () => div({ id: 'd1', name: 'Мужчины · до 76 кг', sortOrder: 1, sex: 'MALE', weightMaxG: 76_000, mat: 1, matOrder: 1 })
// Hand-named.
const D2 = () => div({ id: 'd2', name: 'Элита', sortOrder: 2, sex: 'FEMALE', ageMin: 18 })

type Opts = {
    role?: 'ORG_ADMIN' | 'ORG_COACH' | null
    status?: Status
    matCount?: number
    divisions?: Div[]
    // Non-withdrawn entries per division (the views).
    active?: Record<string, number>
    // Every entry per division, withdrawn included (the delete guard).
    entryTotal?: Record<string, number>
    // Divisions with a decided non-bye match.
    results?: string[]
    claimCount?: number
}

const pick = (row: Record<string, unknown>, select: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(select).filter((k) => select[k] === true).map((k) => [k, row[k]]))

const makePrisma = (o: Opts = {}) => {
    const divs: Div[] = (o.divisions ?? [D1(), D2()]).map((d) => ({ ...d }))
    let created = 0
    const tournamentRow = (id: string) => ({
        id,
        organizationId: ORG,
        eventId: 'e1',
        status: o.status ?? 'SETUP',
        matCount: o.matCount ?? 2,
        resultsPublishedAt: null,
        createdAt: UPDATED_AT,
        updatedAt: UPDATED_AT,
        event: {
            title: 'Кубок',
            startAt: new Date('2026-12-20T03:00:00Z'),
            endAt: null,
            timezone: 'Asia/Tomsk',
            place: null,
            registrationClosesAt: null,
        },
    })
    const inTournament = (where: { tournamentId: string; id?: { in: string[] } }) =>
        divs
            .filter((d) => d.tournamentId === where.tournamentId && (!where.id || where.id.in.includes(d.id)))
            .sort((a, b) => a.sortOrder - b.sortOrder)
    const prisma = {
        organization: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
        organizationMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(o.role === null ? null : { role: o.role ?? 'ORG_ADMIN' }),
        },
        organizationLadderTemplate: {
            findMany: jest.fn(async ({ where }) =>
                [
                    {
                        id: TPL,
                        organizationId: ORG,
                        levels: [
                            { order: 1, name: 'Белый' },
                            { order: 2, name: 'Синий' },
                            { order: 3, name: 'Фиолетовый' },
                            { order: 4, name: 'Коричневый' },
                        ],
                    },
                    { id: FOREIGN_TPL, organizationId: 'other-org', levels: [] },
                ]
                    .filter((t) => where.id.in.includes(t.id) && t.organizationId === where.organizationId)
                    .map(({ id, levels }) => ({ id, levels })),
            ),
        },
        tournament: {
            findFirst: jest.fn(async ({ where }) =>
                [T, FROM].includes(where.id) && where.organizationId === ORG ? tournamentRow(where.id) : null,
            ),
        },
        tournamentDivision: {
            findMany: jest.fn(async ({ where, select }) =>
                inTournament(where).map((d) => pick(d, select)),
            ),
            findFirst: jest.fn(async ({ where, select }) => {
                const d = divs.find((r) => r.id === where.id && r.tournamentId === where.tournamentId)
                if (!d) return null
                return {
                    ...pick(d, select),
                    ...(select._count ? { _count: { entries: o.entryTotal?.[d.id] ?? 0 } } : {}),
                }
            }),
            aggregate: jest.fn(async ({ where }) => {
                const rows = inTournament(where)
                return {
                    _count: { _all: rows.length },
                    _max: { sortOrder: rows.length ? Math.max(...rows.map((d) => d.sortOrder)) : null },
                }
            }),
            createMany: jest.fn(async ({ data }) => {
                for (const d of data) divs.push(div({ ...d, id: `new-${(created += 1)}` }))
                return { count: data.length }
            }),
            updateMany: jest.fn().mockResolvedValue({ count: o.claimCount ?? 1 }),
            update: jest.fn(async ({ where, data }) => {
                Object.assign(divs.find((d) => d.id === where.id) as Div, data)
                return { id: where.id }
            }),
            delete: jest.fn(async ({ where }) => {
                divs.splice(
                    divs.findIndex((d) => d.id === where.id),
                    1,
                )
                return { id: where.id }
            }),
        },
        tournamentEntry: {
            groupBy: jest.fn(async () =>
                Object.entries(o.active ?? {}).map(([divisionId, n]) => ({ divisionId, _count: { _all: n } })),
            ),
        },
        tournamentMatch: {
            groupBy: jest.fn(async () => (o.results ?? []).map((divisionId) => ({ divisionId, _count: { _all: 1 } }))),
        },
        $transaction: jest.fn(async (arg: unknown): Promise<unknown> =>
            typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
        ),
    }
    return { prisma, divs }
}
type Prisma = ReturnType<typeof makePrisma>['prisma']
const audit = () => ({ record: jest.fn() })
type Caller = { userId?: string; superAdmin?: boolean; tournamentId?: string }
const rbac = (prisma: Prisma) => new OrgRbacService(prisma as never)
const who = (c: Caller) => [c.userId ?? 'u1', c.superAdmin ?? false] as const

const list = (prisma: Prisma, c: Caller = {}) =>
    new ListTournamentDivisionsHandler(prisma as never, rbac(prisma)).execute(
        new ListTournamentDivisionsFeature(ORG, c.tournamentId ?? T, ...who(c)),
    )
type Row = NonNullable<ConstructorParameters<typeof CreateTournamentDivisionsFeature>[0]['rows'][number]>
const create = (prisma: Prisma, rows: Row[], a = audit(), c: Caller = {}) =>
    new CreateTournamentDivisionsHandler(prisma as never, rbac(prisma), a as never).execute(
        new CreateTournamentDivisionsFeature({ rows }, ORG, c.tournamentId ?? T, ...who(c)),
    )
const copy = (prisma: Prisma, fromTournamentId: string, a = audit(), c: Caller = {}) =>
    new CopyTournamentDivisionsHandler(prisma as never, rbac(prisma), a as never).execute(
        new CopyTournamentDivisionsFeature({ fromTournamentId }, ORG, c.tournamentId ?? T, ...who(c)),
    )
const update = (
    prisma: Prisma,
    divisionId: string,
    payload: ConstructorParameters<typeof UpdateTournamentDivisionFeature>[0],
    a = audit(),
    c: Caller = {},
) =>
    new UpdateTournamentDivisionHandler(prisma as never, rbac(prisma), a as never).execute(
        new UpdateTournamentDivisionFeature(payload, ORG, c.tournamentId ?? T, divisionId, ...who(c)),
    )
const remove = (prisma: Prisma, divisionId: string, a = audit(), c: Caller = {}) =>
    new DeleteTournamentDivisionHandler(prisma as never, rbac(prisma), a as never).execute(
        new DeleteTournamentDivisionFeature(ORG, c.tournamentId ?? T, divisionId, ...who(c)),
    )
const assign = (prisma: Prisma, a = audit(), c: Caller = {}) =>
    new AssignTournamentMatsHandler(prisma as never, rbac(prisma), a as never).execute(
        new AssignTournamentMatsFeature(ORG, c.tournamentId ?? T, ...who(c)),
    )

const writes = (prisma: Prisma) => [
    prisma.tournamentDivision.createMany,
    prisma.tournamentDivision.update,
    prisma.tournamentDivision.updateMany,
    prisma.tournamentDivision.delete,
    prisma.$transaction,
]
const audited = (action: string, metadata: Record<string, unknown>) => ({
    action,
    targetType: 'tournament',
    targetId: T,
    organizationId: ORG,
    actorId: 'u1',
    metadata,
})

// ─── Access matrix: every handler of the group is staff-tier ─────────────
const cases: Array<{
    name: string
    run: (prisma: Prisma, a: ReturnType<typeof audit>, c: Caller) => Promise<unknown>
}> = [
    { name: 'listTournamentDivisions', run: (p, _a, c) => list(p, c) },
    { name: 'createTournamentDivisions', run: (p, a, c) => create(p, [{ weightMaxKg: 81 }], a, c) },
    { name: 'copyTournamentDivisions', run: (p, a, c) => copy(p, FROM, a, c) },
    { name: 'updateTournamentDivision', run: (p, a, c) => update(p, 'd1', { mat: 2 }, a, c) },
    { name: 'deleteTournamentDivision', run: (p, a, c) => remove(p, 'd2', a, c) },
    { name: 'assignTournamentMats', run: (p, a, c) => assign(p, a, c) },
]

describe.each(cases)('$name access', ({ run }) => {
    it('answers 404 to a non-member and writes nothing', async () => {
        const { prisma } = makePrisma({ role: null })
        const a = audit()
        await expect(run(prisma, a, { userId: 'stranger' })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.organizationMember.findUnique.mock.calls[0][0].where).toEqual({
            organizationId_userId: { organizationId: ORG, userId: 'stranger' },
        })
        expect(prisma.tournament.findFirst).not.toHaveBeenCalled()
        for (const w of writes(prisma)) expect(w).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('admits an org coach', async () => {
        const { prisma } = makePrisma({ role: 'ORG_COACH' })
        await expect(run(prisma, audit(), {})).resolves.toBeDefined()
    })

    it('lets the super admin in without a membership row', async () => {
        const { prisma } = makePrisma({ role: null })
        await expect(run(prisma, audit(), { userId: 'root', superAdmin: true })).resolves.toBeDefined()
        expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's tournament and writes nothing", async () => {
        const { prisma } = makePrisma()
        const a = audit()
        await expect(run(prisma, a, { tournamentId: FOREIGN })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournament.findFirst.mock.calls[0][0].where).toEqual({ id: FOREIGN, organizationId: ORG })
        for (const w of writes(prisma)) expect(w).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })
})

// Every write is closed once the results are published.
describe.each(cases.filter((c) => c.name !== 'listTournamentDivisions'))('$name on a published tournament', ({ run }) => {
    it('refuses with 409 TOURNAMENT_PUBLISHED and writes nothing', async () => {
        const { prisma } = makePrisma({ status: 'FINISHED' })
        const a = audit()
        await expect(run(prisma, a, {})).rejects.toBeInstanceOf(TournamentPublishedError)
        for (const w of writes(prisma)) expect(w).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })
})

// ─── listTournamentDivisions ─────────────────────────────────────────────
describe('listTournamentDivisions', () => {
    it('lists the divisions in order with counts, kg and state', async () => {
        const { prisma } = makePrisma({
            divisions: [
                div({ ...D2(), drawnAt: new Date('2026-12-20T05:00:00Z') }),
                D1(),
                div({ id: 'd3', sortOrder: 3, drawnAt: new Date(), finishedAt: new Date('2026-12-20T07:00:00Z') }),
            ],
            active: { d1: 3, d2: 2 },
            results: ['d2', 'd3'],
        })
        const out = await list(prisma)
        expect(prisma.tournamentDivision.findMany.mock.calls[0][0].where).toEqual({ tournamentId: T })
        expect(out.data.map((d) => [d.id, d.state, d.entryCount, d.hasResults])).toEqual([
            ['d1', 'NOT_DRAWN', 3, false],
            ['d2', 'RUNNING', 2, true],
            ['d3', 'FINISHED', 0, true],
        ])
        expect(out.data[0]).toMatchObject({
            name: 'Мужчины · до 76 кг',
            sex: 'MALE',
            weightMinKg: null,
            weightMaxKg: 76,
            mat: 1,
            matOrder: 1,
            drawnAt: null,
        })
    })
})

// ─── createTournamentDivisions ───────────────────────────────────────────
describe('createTournamentDivisions', () => {
    it('appends the rows with generated names unless given, the level label from the org standard', async () => {
        const { prisma } = makePrisma()
        const a = audit()
        const out = await create(
            prisma,
            [
                {
                    sex: 'MALE',
                    ageMin: 18,
                    ageMax: 35,
                    templateId: TPL,
                    levelOrderFrom: 2,
                    levelOrderTo: 4,
                    weightMaxKg: 76,
                },
                { name: 'Абсолютка', weightMinKg: 94.5 },
                { sex: 'FEMALE', ageMax: 12, weightMinKg: 30, weightMaxKg: 34.5 },
            ],
            a,
        )
        expect(prisma.organizationLadderTemplate.findMany.mock.calls[0][0].where).toEqual({
            id: { in: [TPL] },
            organizationId: ORG,
        })
        const none = {
            sex: null,
            ageMin: null,
            ageMax: null,
            templateId: null,
            levelOrderFrom: null,
            levelOrderTo: null,
            levelLabel: null,
            weightMinG: null,
            weightMaxG: null,
        }
        expect(prisma.tournamentDivision.createMany.mock.calls[0][0].data).toEqual([
            {
                ...none,
                sex: 'MALE',
                ageMin: 18,
                ageMax: 35,
                templateId: TPL,
                levelOrderFrom: 2,
                levelOrderTo: 4,
                levelLabel: 'Синий – Коричневый',
                weightMaxG: 76_000,
                name: 'Мужчины · 18–35 лет · Синий – Коричневый · до 76 кг',
                tournamentId: T,
                sortOrder: 3,
            },
            { ...none, weightMinG: 94_500, name: 'Абсолютка', tournamentId: T, sortOrder: 4 },
            {
                ...none,
                sex: 'FEMALE',
                ageMax: 12,
                weightMinG: 30_000,
                weightMaxG: 34_500,
                name: 'Девочки · до 12 лет · до 34,5 кг',
                tournamentId: T,
                sortOrder: 5,
            },
        ])
        expect(out.data.map((d) => d.name)).toEqual([
            'Мужчины · до 76 кг',
            'Элита',
            'Мужчины · 18–35 лет · Синий – Коричневый · до 76 кг',
            'Абсолютка',
            'Девочки · до 12 лет · до 34,5 кг',
        ])
        expect(a.record.mock.calls[0][0]).toEqual(audited('tournament.divisionsCreate', { tournamentId: T, count: 3 }))
    })

    it('starts the order at 1 in an empty tournament and skips the template lookup without one', async () => {
        const { prisma } = makePrisma({ divisions: [] })
        await create(prisma, [{}])
        expect(prisma.organizationLadderTemplate.findMany).not.toHaveBeenCalled()
        expect(prisma.tournamentDivision.createMany.mock.calls[0][0].data).toEqual([
            expect.objectContaining({ name: 'абсолютная', sortOrder: 1 }),
        ])
    })

    it.each([
        ["another org's standard", { templateId: FOREIGN_TPL }],
        ['age «from» above «to»', { ageMin: 30, ageMax: 18 }],
        ['weight «from» not below «to»', { weightMinKg: 76, weightMaxKg: 76 }],
        ['a level range without a standard', { levelOrderFrom: 2 }],
        ['a level «from» above «to»', { templateId: TPL, levelOrderFrom: 3, levelOrderTo: 2 }],
    ] as const)('refuses %s with 400 and writes nothing', async (_label, row) => {
        const { prisma } = makePrisma()
        const a = audit()
        await expect(create(prisma, [row], a)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.tournamentDivision.createMany).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('takes at most 60 rows per call', () => {
        const rows = (n: number) => ({ rows: Array.from({ length: n }, () => ({ weightMaxKg: 76 })) })
        expect(CreateTournamentDivisionsInputSchema.safeParse(rows(60)).success).toBe(true)
        expect(CreateTournamentDivisionsInputSchema.safeParse(rows(61)).success).toBe(false)
        expect(CreateTournamentDivisionsInputSchema.safeParse(rows(0)).success).toBe(false)
    })

    it('keeps a tournament at 200 divisions at most', async () => {
        const full = Array.from({ length: 195 }, (_, i) => div({ id: `x${i}`, sortOrder: i + 1 }))
        const over = makePrisma({ divisions: full })
        const a = audit()
        await expect(create(over.prisma, Array.from({ length: 6 }, () => ({})), a)).rejects.toThrow(
            'В турнире не больше 200 категорий',
        )
        expect(over.prisma.tournamentDivision.createMany).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()

        const exact = makePrisma({ divisions: full })
        const out = await create(exact.prisma, Array.from({ length: 5 }, () => ({})))
        expect(out.data).toHaveLength(200)
        expect(exact.prisma.tournamentDivision.createMany.mock.calls[0][0].data.at(-1).sortOrder).toBe(200)
    })
})

// ─── copyTournamentDivisions ─────────────────────────────────────────────
describe('copyTournamentDivisions', () => {
    const source = () => [
        div({
            id: 's1',
            tournamentId: FROM,
            name: 'Мужчины · Синий · до 76 кг',
            sortOrder: 1,
            sex: 'MALE',
            templateId: TPL,
            levelOrderFrom: 2,
            levelOrderTo: 2,
            levelLabel: 'Синий',
            weightMaxG: 76_000,
            mat: 1,
            matOrder: 1,
            drawNo: 2,
            drawnAt: new Date('2026-10-01T05:00:00Z'),
            finishedAt: new Date('2026-10-01T07:00:00Z'),
        }),
        // Mat 3 of a three-mat source: dropped in a two-mat tournament.
        div({ id: 's2', tournamentId: FROM, name: 'Женщины', sortOrder: 2, sex: 'FEMALE', mat: 3, matOrder: 2 }),
    ]

    it('appends the criteria, names and fitting mats of another tournament of the org, no draw state', async () => {
        const { prisma } = makePrisma({ divisions: [D1(), ...source()], matCount: 2 })
        const a = audit()
        const out = await copy(prisma, FROM, a)
        expect(prisma.tournament.findFirst.mock.calls[1][0].where).toEqual({ id: FROM, organizationId: ORG })
        expect(prisma.tournamentDivision.findMany.mock.calls[0][0].where).toEqual({ tournamentId: FROM })
        expect(prisma.tournamentDivision.createMany.mock.calls[0][0].data).toEqual([
            {
                name: 'Мужчины · Синий · до 76 кг',
                sex: 'MALE',
                ageMin: null,
                ageMax: null,
                templateId: TPL,
                levelOrderFrom: 2,
                levelOrderTo: 2,
                levelLabel: 'Синий',
                weightMinG: null,
                weightMaxG: 76_000,
                mat: 1,
                matOrder: 1,
                tournamentId: T,
                sortOrder: 2,
            },
            {
                name: 'Женщины',
                sex: 'FEMALE',
                ageMin: null,
                ageMax: null,
                templateId: null,
                levelOrderFrom: null,
                levelOrderTo: null,
                levelLabel: null,
                weightMinG: null,
                weightMaxG: null,
                mat: null,
                matOrder: null,
                tournamentId: T,
                sortOrder: 3,
            },
        ])
        expect(out.data.map((d) => [d.name, d.mat, d.state])).toEqual([
            ['Мужчины · до 76 кг', 1, 'NOT_DRAWN'],
            ['Мужчины · Синий · до 76 кг', 1, 'NOT_DRAWN'],
            ['Женщины', null, 'NOT_DRAWN'],
        ])
        expect(a.record.mock.calls[0][0]).toEqual(
            audited('tournament.divisionsCopy', { tournamentId: T, fromTournamentId: FROM, count: 2 }),
        )
    })

    it("answers 404 for a source tournament of another org", async () => {
        const { prisma } = makePrisma()
        const a = audit()
        await expect(copy(prisma, FOREIGN, a)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournament.findFirst.mock.calls[1][0].where).toEqual({ id: FOREIGN, organizationId: ORG })
        expect(prisma.tournamentDivision.createMany).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('refuses copying a tournament onto itself with 400', async () => {
        const { prisma } = makePrisma()
        await expect(copy(prisma, T)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.tournamentDivision.createMany).not.toHaveBeenCalled()
    })

    it('keeps the tournament at 200 divisions at most', async () => {
        const full = Array.from({ length: 199 }, (_, i) => div({ id: `x${i}`, sortOrder: i + 1 }))
        const { prisma } = makePrisma({ divisions: [...full, ...source()] })
        const a = audit()
        await expect(copy(prisma, FROM, a)).rejects.toThrow('В турнире не больше 200 категорий')
        expect(prisma.tournamentDivision.createMany).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })
})

// ─── updateTournamentDivision ────────────────────────────────────────────
describe('updateTournamentDivision', () => {
    it('renames an auto-named division after its new criteria, claiming the read version', async () => {
        const { prisma } = makePrisma()
        const a = audit()
        const out = await update(prisma, 'd1', { weightMaxKg: 81, expectedUpdatedAt: UPDATED_AT.toISOString() }, a)
        expect(prisma.tournamentDivision.findFirst.mock.calls[0][0].where).toEqual({ id: 'd1', tournamentId: T })
        expect(prisma.tournamentDivision.updateMany.mock.calls[0][0].where).toEqual({
            id: 'd1',
            updatedAt: UPDATED_AT,
        })
        const write = prisma.tournamentDivision.update.mock.calls[0][0]
        expect(write.where).toEqual({ id: 'd1' })
        expect(write.data).toEqual({
            sex: 'MALE',
            ageMin: null,
            ageMax: null,
            templateId: null,
            levelOrderFrom: null,
            levelOrderTo: null,
            levelLabel: null,
            weightMinG: null,
            weightMaxG: 81_000,
            name: 'Мужчины · до 81 кг',
        })
        // Mats untouched when not sent.
        expect(write.data).not.toHaveProperty('mat')
        expect(out).toMatchObject({ id: 'd1', name: 'Мужчины · до 81 кг', weightMaxKg: 81, mat: 1 })
        expect(a.record.mock.calls[0][0]).toEqual(
            audited('tournament.divisionUpdate', {
                tournamentId: T,
                divisionId: 'd1',
                divisionName: 'Мужчины · до 81 кг',
                fields: ['weightMaxKg'],
            }),
        )
    })

    it('keeps a hand-edited name and takes a typed one', async () => {
        const kept = makePrisma()
        const out = await update(kept.prisma, 'd2', { ageMin: 21 })
        expect(kept.prisma.tournamentDivision.update.mock.calls[0][0].data).toMatchObject({ ageMin: 21, name: 'Элита' })
        expect(out.name).toBe('Элита')

        const typed = makePrisma()
        await update(typed.prisma, 'd1', { name: 'Мужчины (основа)' })
        expect(typed.prisma.tournamentDivision.update.mock.calls[0][0].data.name).toBe('Мужчины (основа)')
    })

    it('sets and clears the mat and queue place', async () => {
        const set = makePrisma()
        const out = await update(set.prisma, 'd2', { mat: 2, matOrder: 3 })
        expect(set.prisma.tournamentDivision.update.mock.calls[0][0].data).toMatchObject({ mat: 2, matOrder: 3 })
        expect(out).toMatchObject({ mat: 2, matOrder: 3 })

        const cleared = makePrisma()
        const after = await update(cleared.prisma, 'd1', { mat: null, matOrder: null })
        expect(cleared.prisma.tournamentDivision.update.mock.calls[0][0].data).toMatchObject({
            mat: null,
            matOrder: null,
        })
        expect(after).toMatchObject({ mat: null, matOrder: null })
    })

    it('picks a level range of the org standard, labelled', async () => {
        const { prisma } = makePrisma()
        await update(prisma, 'd1', { templateId: TPL, levelOrderFrom: 1, levelOrderTo: 2 })
        expect(prisma.organizationLadderTemplate.findMany.mock.calls[0][0].where).toEqual({
            id: { in: [TPL] },
            organizationId: ORG,
        })
        expect(prisma.tournamentDivision.update.mock.calls[0][0].data).toMatchObject({
            templateId: TPL,
            levelLabel: 'Белый – Синий',
            name: 'Мужчины · Белый – Синий · до 76 кг',
        })
    })

    it('refuses a mat beyond the tournament mats with 400', async () => {
        const { prisma } = makePrisma({ matCount: 2 })
        await expect(update(prisma, 'd1', { mat: 3 })).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it("refuses another org's standard with 400", async () => {
        const { prisma } = makePrisma()
        await expect(update(prisma, 'd1', { templateId: FOREIGN_TPL })).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('answers STALE_UPDATE for an older expectedUpdatedAt and changes nothing', async () => {
        const { prisma } = makePrisma({ claimCount: 0 })
        const a = audit()
        await expect(
            update(prisma, 'd1', { weightMaxKg: 81, expectedUpdatedAt: '2026-11-24T00:00:00.000Z' }, a),
        ).rejects.toBeInstanceOf(StaleUpdateError)
        expect(prisma.tournamentDivision.update).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it("answers 404 for a division of another tournament", async () => {
        const { prisma } = makePrisma({ divisions: [D1(), div({ id: 's1', tournamentId: FROM })] })
        await expect(update(prisma, 's1', { mat: 1 })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournamentDivision.findFirst.mock.calls[0][0].where).toEqual({ id: 's1', tournamentId: T })
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })
})

// ─── deleteTournamentDivision ────────────────────────────────────────────
describe('deleteTournamentDivision', () => {
    it('deletes an empty division, audited by id and name', async () => {
        const { prisma, divs } = makePrisma()
        const a = audit()
        await expect(remove(prisma, 'd2', a)).resolves.toEqual({ status: 'deleted' })
        expect(prisma.tournamentDivision.delete).toHaveBeenCalledWith({ where: { id: 'd2' } })
        expect(divs.map((d) => d.id)).toEqual(['d1'])
        expect(a.record.mock.calls[0][0]).toEqual(
            audited('tournament.divisionDelete', { tournamentId: T, divisionId: 'd2', divisionName: 'Элита' }),
        )
    })

    it('refuses a division with entries (withdrawn included) with 400', async () => {
        const { prisma } = makePrisma({ entryTotal: { d2: 1 } })
        const a = audit()
        await expect(remove(prisma, 'd2', a)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.tournamentDivision.delete).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('answers 404 for a division of another tournament', async () => {
        const { prisma } = makePrisma({ divisions: [div({ id: 's1', tournamentId: FROM })] })
        await expect(remove(prisma, 's1')).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournamentDivision.findFirst.mock.calls[0][0].where).toEqual({ id: 's1', tournamentId: T })
        expect(prisma.tournamentDivision.delete).not.toHaveBeenCalled()
    })
})

// ─── assignTournamentMats ────────────────────────────────────────────────
describe('assignTournamentMats', () => {
    it('spreads the divisions without results over the mats, the ones with results keep theirs', async () => {
        const { prisma } = makePrisma({
            matCount: 2,
            divisions: [
                div({ id: 'a', sortOrder: 1 }),
                div({ id: 'b', sortOrder: 2 }),
                div({ id: 'c', sortOrder: 3, mat: 2, matOrder: 1, drawnAt: new Date() }),
            ],
            active: { a: 3, b: 5, c: 2 },
            results: ['c'],
        })
        const a = audit()
        const out = await assign(prisma, a)
        expect(prisma.tournamentDivision.update.mock.calls.map(([q]) => q)).toEqual([
            { where: { id: 'b' }, data: { mat: 1, matOrder: 1 }, select: { id: true } },
            { where: { id: 'a' }, data: { mat: 2, matOrder: 2 }, select: { id: true } },
        ])
        expect(out.data.map((d) => [d.id, d.mat, d.matOrder])).toEqual([
            ['a', 2, 2],
            ['b', 1, 1],
            ['c', 2, 1],
        ])
        expect(a.record.mock.calls[0][0]).toEqual(
            audited('tournament.matsAssign', { tournamentId: T, count: 2, matCount: 2 }),
        )
    })
})
