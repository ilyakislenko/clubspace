jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))

import { OrgRbacService } from '../../../domains/organizations/org-access'
import {
    TournamentPublishedError,
    TournamentUnassignedError,
} from '../../../domains/tournaments/tournament-errors'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    StaleUpdateError,
} from '../../../shared/errors/shared.errors'
import { CreateOrgTournamentHandler } from './create-org-tournament.handler'
import { GetOrgTournamentHandler } from './get-org-tournament.handler'
import { PublishOrgTournamentResultsHandler } from './publish-org-tournament-results.handler'
import { SetOrgTournamentStatusHandler } from './set-org-tournament-status.handler'
import {
    CreateOrgTournamentFeature,
    GetOrgTournamentFeature,
    PublishOrgTournamentResultsFeature,
    SetOrgTournamentStatusFeature,
    UpdateOrgTournamentFeature,
} from './tournament.feature'
import { UpdateOrgTournamentHandler } from './update-org-tournament.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const EVENT = '22222222-2222-4222-8222-222222222222'
const T = '33333333-3333-4333-8333-333333333333'
// A tournament / event id of another org: the scoped lookups never match it.
const FOREIGN = '44444444-4444-4444-8444-444444444444'
const CREATED_AT = new Date('2026-11-20T00:00:00Z')
const UPDATED_AT = new Date('2026-11-25T00:00:00Z')

type Status = 'SETUP' | 'WEIGH_IN' | 'RUNNING' | 'FINISHED'
type Role = 'ORG_ADMIN' | 'ORG_COACH'

type Opts = {
    // null = no OrganizationMember row.
    role?: Role | null
    exists?: boolean
    status?: Status
    matCount?: number
    eventKind?: string
    claimCount?: number
    weighed?: number
    unweighed?: number
    unassignedWeighed?: number
    undrawn?: Array<{ id: string; name: string }>
    sizes?: Record<string, number>
    unfinished?: Array<{ id: string; drawnAt: Date | null; _count: { entries: number } }>
}

const makePrisma = (o: Opts = {}) => {
    const state = {
        exists: o.exists ?? true,
        status: o.status ?? 'SETUP',
        matCount: o.matCount ?? 2,
        resultsPublishedAt: (o.status === 'FINISHED' ? new Date('2026-11-24T12:00:00Z') : null) as
            | Date
            | null,
        weighed: o.weighed ?? 0,
        confirmed: (o.weighed ?? 0) + (o.unweighed ?? 0),
        withdrawn: 0,
    }
    const row = () => ({
        id: T,
        organizationId: ORG,
        eventId: EVENT,
        status: state.status,
        matCount: state.matCount,
        resultsPublishedAt: state.resultsPublishedAt,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        event: {
            title: 'Кубок Томска',
            startAt: new Date('2026-12-20T03:00:00Z'),
            endAt: null,
            timezone: 'Asia/Tomsk',
            place: 'СК «Победа»',
            registrationClosesAt: null,
        },
    })
    const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    const prisma = {
        organization: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
        organizationMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(o.role === null ? null : { role: o.role ?? 'ORG_ADMIN' }),
        },
        organizationEvent: {
            findFirst: jest.fn(async ({ where }) =>
                where.id === EVENT && where.organizationId === ORG
                    ? { id: EVENT, kind: o.eventKind ?? 'COMPETITION' }
                    : null,
            ),
        },
        organizationEventRegistration: { count: jest.fn().mockResolvedValue(7) },
        tournament: {
            create: jest.fn(async ({ data }) => {
                if (state.exists) throw p2002()
                state.exists = true
                state.matCount = data.matCount
                return row()
            }),
            findUniqueOrThrow: jest.fn(async (_q: { where: { eventId: string } }) => {
                if (!state.exists) throw new Error('not found')
                return row()
            }),
            findFirst: jest.fn(async ({ where }) =>
                state.exists && where.id === T && where.organizationId === ORG ? row() : null,
            ),
            updateMany: jest.fn().mockResolvedValue({ count: o.claimCount ?? 1 }),
            update: jest.fn(async ({ data }) => {
                Object.assign(state, data)
                return row()
            }),
        },
        tournamentEntry: {
            groupBy: jest.fn(async ({ by }) =>
                by[0] === 'status'
                    ? [
                          { status: 'CONFIRMED', _count: { _all: state.confirmed } },
                          { status: 'WITHDRAWN', _count: { _all: state.withdrawn } },
                      ]
                    : Object.entries(o.sizes ?? {}).map(([divisionId, n]) => ({
                          divisionId,
                          _count: { _all: n },
                      })),
            ),
            count: jest.fn(async ({ where }) => {
                if (where.divisionId === null) return o.unassignedWeighed ?? 0
                return state.weighed
            }),
            updateMany: jest.fn(async ({ data }) => {
                if (data.status !== 'WITHDRAWN') return { count: 0 }
                const count = state.confirmed - state.weighed
                state.confirmed -= count
                state.withdrawn += count
                return { count }
            }),
            findMany: jest.fn(async ({ where }) =>
                Array.from({ length: o.sizes?.[where.divisionId] ?? 0 }, (_, i) => ({
                    id: `${where.divisionId}-e${i + 1}`,
                    workspaceId: `club-${i + 1}`,
                })),
            ),
            update: jest.fn().mockResolvedValue({ id: 'e' }),
        },
        tournamentDivision: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn(async ({ where }) =>
                where.drawnAt === null ? (o.undrawn ?? []) : (o.unfinished ?? []),
            ),
            updateMany: jest.fn().mockResolvedValue({ count: 2 }),
            update: jest.fn().mockResolvedValue({ drawNo: 1 }),
        },
        tournamentMatch: {
            count: jest.fn().mockResolvedValue(0),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        // lockTournament / lockDivisions (SELECT … FOR UPDATE).
        $queryRaw: jest.fn(async () => [{ status: state.status }]),
        $transaction: jest.fn(async (arg: unknown): Promise<unknown> =>
            typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
        ),
    }
    return prisma
}
type Prisma = ReturnType<typeof makePrisma>
const audit = () => ({ record: jest.fn() })
type Caller = { userId?: string; superAdmin?: boolean; id?: string }

// matCount null = omitted.
const create = (prisma: Prisma, a = audit(), c: Caller = {}, matCount: number | null = 3) =>
    new CreateOrgTournamentHandler(prisma as never, new OrgRbacService(prisma as never), a as never).execute(
        new CreateOrgTournamentFeature(
            matCount === null ? {} : { matCount },
            ORG,
            c.id ?? EVENT,
            c.userId ?? 'u1',
            c.superAdmin ?? false,
        ),
    )
const get = (prisma: Prisma, c: Caller = {}) =>
    new GetOrgTournamentHandler(prisma as never, new OrgRbacService(prisma as never)).execute(
        new GetOrgTournamentFeature(ORG, c.id ?? T, c.userId ?? 'u1', c.superAdmin ?? false),
    )
const update = (
    prisma: Prisma,
    payload: { matCount: number; expectedUpdatedAt?: string },
    a = audit(),
    c: Caller = {},
) =>
    new UpdateOrgTournamentHandler(prisma as never, new OrgRbacService(prisma as never), a as never).execute(
        new UpdateOrgTournamentFeature(payload, ORG, c.id ?? T, c.userId ?? 'u1', c.superAdmin ?? false),
    )
const setStatus = (
    prisma: Prisma,
    status: 'SETUP' | 'WEIGH_IN' | 'RUNNING',
    a = audit(),
    c: Caller = {},
) =>
    new SetOrgTournamentStatusHandler(prisma as never, new OrgRbacService(prisma as never), a as never).execute(
        new SetOrgTournamentStatusFeature({ status }, ORG, c.id ?? T, c.userId ?? 'u1', c.superAdmin ?? false),
    )
const publish = (prisma: Prisma, published: boolean, a = audit(), c: Caller = {}) =>
    new PublishOrgTournamentResultsHandler(
        prisma as never,
        new OrgRbacService(prisma as never),
        a as never,
    ).execute(
        new PublishOrgTournamentResultsFeature(
            { published },
            ORG,
            c.id ?? T,
            c.userId ?? 'u1',
            c.superAdmin ?? false,
        ),
    )

const writes = (prisma: Prisma) => [
    prisma.tournament.create,
    prisma.tournament.update,
    prisma.tournament.updateMany,
    prisma.tournamentDivision.updateMany,
    prisma.tournamentEntry.updateMany,
    prisma.$transaction,
]

// ─── Access matrix: every handler of the group ──────────────────────────
const cases: Array<{
    name: string
    tier: 'admin' | 'staff'
    opts: Opts
    run: (prisma: Prisma, a: ReturnType<typeof audit>, c: Caller) => Promise<unknown>
}> = [
    { name: 'createOrgTournament', tier: 'admin', opts: { exists: false }, run: (p, a, c) => create(p, a, c) },
    { name: 'getOrgTournament', tier: 'staff', opts: {}, run: (p, _a, c) => get(p, c) },
    { name: 'updateOrgTournament', tier: 'admin', opts: {}, run: (p, a, c) => update(p, { matCount: 3 }, a, c) },
    { name: 'setOrgTournamentStatus', tier: 'staff', opts: {}, run: (p, a, c) => setStatus(p, 'WEIGH_IN', a, c) },
    {
        name: 'publishOrgTournamentResults',
        tier: 'admin',
        opts: { status: 'RUNNING' },
        run: (p, a, c) => publish(p, true, a, c),
    },
]

describe.each(cases)('$name access', ({ tier, opts, run }) => {
    it('answers 404 to a non-member and writes nothing', async () => {
        const prisma = makePrisma({ ...opts, role: null })
        const a = audit()
        await expect(run(prisma, a, { userId: 'stranger' })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.organizationMember.findUnique.mock.calls[0][0].where).toEqual({
            organizationId_userId: { organizationId: ORG, userId: 'stranger' },
        })
        for (const w of writes(prisma)) expect(w).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    if (tier === 'admin') {
        it('refuses an org coach with 403 and writes nothing', async () => {
            const prisma = makePrisma({ ...opts, role: 'ORG_COACH' })
            const a = audit()
            await expect(run(prisma, a, {})).rejects.toBeInstanceOf(ForbiddenError)
            for (const w of writes(prisma)) expect(w).not.toHaveBeenCalled()
            expect(a.record).not.toHaveBeenCalled()
        })
    } else {
        it('admits an org coach', async () => {
            const prisma = makePrisma({ ...opts, role: 'ORG_COACH' })
            await expect(run(prisma, audit(), {})).resolves.toMatchObject({ id: T })
        })
    }

    it('lets the super admin in without a membership row', async () => {
        const prisma = makePrisma({ ...opts, role: null })
        await expect(run(prisma, audit(), { userId: 'root', superAdmin: true })).resolves.toMatchObject({
            id: T,
        })
        expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's id and writes nothing", async () => {
        const prisma = makePrisma(opts)
        const a = audit()
        await expect(run(prisma, a, { id: FOREIGN })).rejects.toBeInstanceOf(NotFoundError)
        for (const w of writes(prisma)) expect(w).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })
})

// ─── createOrgTournament ─────────────────────────────────────────────────
describe('createOrgTournament', () => {
    it('creates one tournament on a COMPETITION event and a second call returns the same', async () => {
        const prisma = makePrisma({ exists: false })
        const a = audit()
        const first = await create(prisma, a, {}, 3)
        expect(prisma.organizationEvent.findFirst.mock.calls[0][0].where).toEqual({
            id: EVENT,
            organizationId: ORG,
        })
        expect(prisma.tournament.create.mock.calls[0][0].data).toEqual({
            organizationId: ORG,
            eventId: EVENT,
            matCount: 3,
            createdById: 'u1',
        })
        expect(first).toMatchObject({
            id: T,
            eventId: EVENT,
            status: 'SETUP',
            matCount: 3,
            event: { title: 'Кубок Томска', localDate: '2026-12-20' },
            counts: { registrations: 7 },
        })
        expect(a.record).toHaveBeenCalledTimes(1)
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.create',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'u1',
            metadata: { tournamentId: T, eventId: EVENT, matCount: 3 },
        })

        // The second «Провести турнир»: the unique eventId trips, the existing row comes back.
        const second = await create(prisma, a, {}, 5)
        expect(prisma.tournament.create).toHaveBeenCalledTimes(2)
        expect(prisma.tournament.findUniqueOrThrow.mock.calls[0][0].where).toEqual({ eventId: EVENT })
        expect(second).toMatchObject({ id: T, matCount: 3 })
        expect(a.record).toHaveBeenCalledTimes(1)
    })

    it('defaults to one mat', async () => {
        const prisma = makePrisma({ exists: false })
        const out = await create(prisma, audit(), {}, null)
        expect(prisma.tournament.create.mock.calls[0][0].data.matCount).toBe(1)
        expect(out.matCount).toBe(1)
    })

    it('refuses a non-COMPETITION event with 400', async () => {
        const prisma = makePrisma({ exists: false, eventKind: 'SEMINAR' })
        const a = audit()
        await expect(create(prisma, a)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.tournament.create).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('rethrows a failure other than the unique violation', async () => {
        const prisma = makePrisma({ exists: false })
        prisma.tournament.create.mockRejectedValueOnce(new Error('db down'))
        await expect(create(prisma)).rejects.toThrow('db down')
        expect(prisma.tournament.findUniqueOrThrow).not.toHaveBeenCalled()
    })
})

// ─── getOrgTournament ────────────────────────────────────────────────────
describe('getOrgTournament', () => {
    it('answers the card with the counts', async () => {
        const prisma = makePrisma({ status: 'WEIGH_IN', weighed: 4, unweighed: 2, unassignedWeighed: 1 })
        const out = await get(prisma)
        expect(prisma.tournament.findFirst.mock.calls[0][0].where).toEqual({ id: T, organizationId: ORG })
        expect(out).toEqual({
            id: T,
            organizationId: ORG,
            eventId: EVENT,
            event: {
                title: 'Кубок Томска',
                startAt: '2026-12-20T03:00:00.000Z',
                endAt: null,
                timezone: 'Asia/Tomsk',
                place: 'СК «Победа»',
                localDate: '2026-12-20',
            },
            status: 'WEIGH_IN',
            matCount: 2,
            resultsPublishedAt: null,
            counts: {
                registrations: 7,
                declared: 0,
                confirmed: 6,
                withdrawn: 0,
                weighed: 4,
                unweighed: 2,
                unassigned: 1,
                divisions: 0,
                divisionsDrawn: 0,
                divisionsFinished: 0,
            },
            createdAt: CREATED_AT.toISOString(),
            updatedAt: UPDATED_AT.toISOString(),
        })
    })
})

// ─── updateOrgTournament ─────────────────────────────────────────────────
describe('updateOrgTournament', () => {
    it('sets the mats and unassigns the divisions of the dropped ones', async () => {
        const prisma = makePrisma({ matCount: 4 })
        const a = audit()
        const out = await update(prisma, { matCount: 2 }, a)
        expect(prisma.tournamentDivision.updateMany.mock.calls[0][0]).toEqual({
            where: { tournamentId: T, mat: { gt: 2 } },
            data: { mat: null, matOrder: null },
        })
        expect(prisma.tournament.update.mock.calls[0][0]).toMatchObject({
            where: { id: T },
            data: { matCount: 2 },
        })
        // No expectedUpdatedAt: last write wins, no claim.
        expect(prisma.tournament.updateMany).not.toHaveBeenCalled()
        expect(out.matCount).toBe(2)
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.update',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'u1',
            metadata: { tournamentId: T, eventId: EVENT, matCount: 2 },
        })
    })

    it('claims the version read by the form', async () => {
        const prisma = makePrisma()
        await update(prisma, { matCount: 3, expectedUpdatedAt: UPDATED_AT.toISOString() })
        expect(prisma.tournament.updateMany.mock.calls[0][0].where).toEqual({ id: T, updatedAt: UPDATED_AT })
        expect(prisma.tournament.update.mock.calls[0][0].data).toEqual({ matCount: 3 })
    })

    it('answers STALE_UPDATE for an older expectedUpdatedAt and changes nothing', async () => {
        const prisma = makePrisma({ claimCount: 0 })
        const a = audit()
        await expect(
            update(prisma, { matCount: 3, expectedUpdatedAt: '2026-11-24T00:00:00.000Z' }, a),
        ).rejects.toBeInstanceOf(StaleUpdateError)
        expect(prisma.tournamentDivision.updateMany).not.toHaveBeenCalled()
        expect(prisma.tournament.update).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('refuses a published tournament with 409', async () => {
        const prisma = makePrisma({ status: 'FINISHED' })
        await expect(update(prisma, { matCount: 3 })).rejects.toBeInstanceOf(TournamentPublishedError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })
})

// ─── setOrgTournamentStatus ──────────────────────────────────────────────
describe('setOrgTournamentStatus', () => {
    it.each([
        ['SETUP', 'WEIGH_IN'],
        ['WEIGH_IN', 'SETUP'],
    ] as const)('moves %s → %s, audited without counts', async (from, to) => {
        const prisma = makePrisma({ status: from, role: 'ORG_COACH' })
        const a = audit()
        const out = await setStatus(prisma, to, a)
        expect(prisma.tournament.update.mock.calls[0][0]).toMatchObject({
            where: { id: T },
            data: { status: to },
        })
        expect(prisma.tournamentEntry.updateMany).not.toHaveBeenCalled()
        expect(out.status).toBe(to)
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.statusChange',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'u1',
            metadata: { tournamentId: T, fromStatus: from, toStatus: to },
        })
    })

    it('keeps the same status without an audit entry', async () => {
        const prisma = makePrisma({ status: 'WEIGH_IN' })
        const a = audit()
        const out = await setStatus(prisma, 'WEIGH_IN', a)
        expect(prisma.tournament.update).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
        expect(out.status).toBe('WEIGH_IN')
    })

    it.each([
        ['SETUP', 'RUNNING'],
        ['RUNNING', 'WEIGH_IN'],
        ['RUNNING', 'SETUP'],
    ] as const)('refuses %s → %s with 400', async (from, to) => {
        const prisma = makePrisma({ status: from })
        const a = audit()
        await expect(setStatus(prisma, to, a)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.tournament.update).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('refuses to leave FINISHED with 409 TOURNAMENT_PUBLISHED', async () => {
        const prisma = makePrisma({ status: 'FINISHED' })
        await expect(setStatus(prisma, 'RUNNING')).rejects.toBeInstanceOf(TournamentPublishedError)
        expect(prisma.tournament.update).not.toHaveBeenCalled()
    })

    it('refuses the start while a weighed entry has no division (409)', async () => {
        const prisma = makePrisma({ status: 'WEIGH_IN', weighed: 5, unweighed: 2, unassignedWeighed: 3 })
        const a = audit()
        const err = await setStatus(prisma, 'RUNNING', a).catch((e) => e)
        expect(err).toBeInstanceOf(TournamentUnassignedError)
        expect(err).toMatchObject({ statusCode: 409, code: 'TOURNAMENT_UNASSIGNED', metadata: { count: 3 } })
        expect(prisma.tournamentEntry.count.mock.calls[0][0].where).toEqual({
            tournamentId: T,
            status: 'CONFIRMED',
            weighedWeightG: { not: null },
            divisionId: null,
        })
        expect(prisma.tournamentEntry.updateMany).not.toHaveBeenCalled()
        expect(prisma.tournament.update).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it('starts: withdraws the unweighed, draws the undrawn divisions with entrants, counts in the audit', async () => {
        const prisma = makePrisma({
            status: 'WEIGH_IN',
            weighed: 2,
            unweighed: 3,
            undrawn: [
                { id: 'd1', name: 'Мужчины · до 76 кг' },
                { id: 'd2', name: 'Мужчины · до 81 кг' },
            ],
            sizes: { d1: 2 },
        })
        const a = audit()
        const out = await setStatus(prisma, 'RUNNING', a)
        expect(prisma.tournamentEntry.updateMany.mock.calls[0][0]).toEqual({
            where: { tournamentId: T, status: { in: ['DECLARED', 'CONFIRMED'] }, weighedWeightG: null },
            data: { status: 'WITHDRAWN', withdrawnReason: 'Не взвешен' },
        })
        // d1 drawn, d2 (nobody weighed in it) waits.
        const drawn = prisma.tournamentDivision.update.mock.calls
            .filter(([q]) => q.data.drawnAt)
            .map(([q]) => q.where.id)
        expect(drawn).toEqual(['d1'])
        expect(prisma.tournamentMatch.createMany.mock.calls[0][0].data).toEqual([
            expect.objectContaining({ divisionId: 'd1', tournamentId: T, round: 1, isBye: false }),
        ])
        expect(prisma.tournament.update.mock.calls.at(-1)?.[0].data).toEqual({ status: 'RUNNING' })
        expect(out).toMatchObject({ status: 'RUNNING', counts: { withdrawn: 3, unweighed: 0, confirmed: 2 } })
        expect(a.record.mock.calls[0][0].metadata).toEqual({
            tournamentId: T,
            fromStatus: 'WEIGH_IN',
            toStatus: 'RUNNING',
            withdrawnCount: 3,
            drawnCount: 1,
        })
    })

    it('refuses the start when a division is over the draw limit', async () => {
        const prisma = makePrisma({
            status: 'WEIGH_IN',
            undrawn: [{ id: 'd1', name: 'Абсолютная' }],
            sizes: { d1: 65 },
        })
        await expect(setStatus(prisma, 'RUNNING')).rejects.toThrow(/Разделите категорию: Абсолютная/)
        expect(prisma.tournamentEntry.updateMany).not.toHaveBeenCalled()
    })
})

// ─── publishOrgTournamentResults ─────────────────────────────────────────
describe('publishOrgTournamentResults', () => {
    it('names the admin tier in the 403', async () => {
        await expect(publish(makePrisma({ status: 'RUNNING', role: 'ORG_COACH' }), true)).rejects.toThrow(
            'Итоги публикует администратор федерации',
        )
    })

    it('publishes a RUNNING tournament with every division finished', async () => {
        const prisma = makePrisma({ status: 'RUNNING' })
        const a = audit()
        const out = await publish(prisma, true, a)
        expect(prisma.tournamentDivision.findMany.mock.calls[0][0].where).toEqual({
            tournamentId: T,
            finishedAt: null,
        })
        const data = prisma.tournament.update.mock.calls[0][0].data
        expect(data.status).toBe('FINISHED')
        expect(data.resultsPublishedAt).toBeInstanceOf(Date)
        expect(out).toMatchObject({ status: 'FINISHED', resultsPublishedAt: data.resultsPublishedAt.toISOString() })
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.publish',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'u1',
            metadata: { tournamentId: T },
        })
    })

    it('refuses with 400 while a drawn division or one with entrants is unfinished', async () => {
        const prisma = makePrisma({
            status: 'RUNNING',
            unfinished: [
                { id: 'd1', drawnAt: new Date(), _count: { entries: 0 } },
                { id: 'd2', drawnAt: null, _count: { entries: 2 } },
                // Empty and never drawn: does not block.
                { id: 'd3', drawnAt: null, _count: { entries: 0 } },
            ],
        })
        const a = audit()
        await expect(publish(prisma, true, a)).rejects.toThrow('Не закончены: 2 категории')
        expect(prisma.tournament.update).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it.each(['SETUP', 'WEIGH_IN'] as const)('refuses to publish in %s with 400', async (status) => {
        const prisma = makePrisma({ status })
        await expect(publish(prisma, true)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.tournament.update).not.toHaveBeenCalled()
    })

    it('unpublishes back to RUNNING, audited', async () => {
        const prisma = makePrisma({ status: 'FINISHED' })
        const a = audit()
        const out = await publish(prisma, false, a)
        expect(prisma.tournament.update.mock.calls[0][0].data).toEqual({
            status: 'RUNNING',
            resultsPublishedAt: null,
        })
        expect(out).toMatchObject({ status: 'RUNNING', resultsPublishedAt: null })
        expect(a.record.mock.calls[0][0]).toMatchObject({
            action: 'tournament.unpublish',
            metadata: { tournamentId: T },
        })
    })

    it.each([
        ['FINISHED', true],
        ['RUNNING', false],
    ] as const)('is a no-op in %s for published=%s', async (status, published) => {
        const prisma = makePrisma({ status })
        const a = audit()
        const out = await publish(prisma, published, a)
        expect(prisma.tournament.update).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
        expect(out.status).toBe(status)
    })

    it('refuses to unpublish what was never published with 400', async () => {
        const prisma = makePrisma({ status: 'WEIGH_IN' })
        await expect(publish(prisma, false)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.tournament.update).not.toHaveBeenCalled()
    })
})
