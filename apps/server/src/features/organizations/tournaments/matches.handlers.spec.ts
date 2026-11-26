jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))
// The store runs whole locked transactions; the fakes below apply what it
// was asked to write so the handler's bracket re-read sees the change.
jest.mock('../../../domains/tournaments/tournament-store', () => ({
    drawDivision: jest.fn(),
    recordResult: jest.fn(),
    undoResult: jest.fn(),
}))
jest.mock('../../../domains/tournaments/tournament-dispatch', () => ({
    notifyMatchSoon: jest.fn().mockResolvedValue(0),
}))

import { OrgRbacService } from '../../../domains/organizations/org-access'
import { notifyMatchSoon } from '../../../domains/tournaments/tournament-dispatch'
import { drawDivision, recordResult, undoResult } from '../../../domains/tournaments/tournament-store'
import { BadRequestError, NotFoundError, StaleUpdateError } from '../../../shared/errors/shared.errors'
import { DrawTournamentDivisionHandler } from './draw-tournament-division.handler'
import { GetTournamentBracketHandler } from './get-tournament-bracket.handler'
import { GetTournamentMatQueueHandler } from './get-tournament-mat-queue.handler'
import { GetTournamentResultsHandler } from './get-tournament-results.handler'
import {
    DrawTournamentDivisionFeature,
    GetTournamentBracketFeature,
    GetTournamentMatQueueFeature,
    GetTournamentResultsFeature,
    RecordTournamentMatchResultFeature,
    UndoTournamentMatchResultFeature,
} from './matches.feature'
import { RecordTournamentMatchResultHandler } from './record-tournament-match-result.handler'
import { UndoTournamentMatchResultHandler } from './undo-tournament-match-result.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const CLUB = '22222222-2222-4222-8222-222222222222'
const T = 't1'
const OTHER_T = 't-other'
const STAMP = new Date('2026-12-20T05:00:00Z')

type Role = 'ORG_ADMIN' | 'ORG_COACH' | null

// ─── Fixture: a running tournament ───────────────────────────────────────
// Mat 1: «A» (matOrder 1, 8 entrants, round 1 open) then «B» (matOrder 2,
// its first match decided). Mat 2: «C». «U» is drawn but has no mat, «N» is
// not drawn and has no mat, «FIN» is finished with places, «W» waits for
// the draw.

const division = (id: string, name: string, o: Record<string, unknown> = {}) => ({
    id,
    tournamentId: T,
    name,
    sortOrder: 0,
    sex: 'MALE',
    ageMin: null,
    ageMax: null,
    templateId: null,
    levelOrderFrom: null,
    levelOrderTo: null,
    levelLabel: null,
    weightMinG: null,
    weightMaxG: null,
    mat: null as number | null,
    matOrder: null as number | null,
    drawNo: 1,
    drawnAt: STAMP as Date | null,
    finishedAt: null as Date | null,
    updatedAt: STAMP,
    ...o,
})
type DivisionFixture = ReturnType<typeof division>

const match = (divisionId: string, round: number, position: number, o: Record<string, unknown> = {}) => ({
    id: `${divisionId}-${round}-${position}`,
    tournamentId: T,
    divisionId,
    round,
    position,
    entryAId: null as string | null,
    entryBId: null as string | null,
    isBye: false,
    winnerEntryId: null as string | null,
    method: null as string | null,
    scoreA: null as number | null,
    scoreB: null as number | null,
    note: null as string | null,
    decidedAt: null as Date | null,
    updatedAt: STAMP,
    ...o,
})
type MatchFixture = ReturnType<typeof match>

const entry = (id: string, lastname: string, divisionId: string | null, o: Record<string, unknown> = {}) => ({
    id,
    tournamentId: T,
    userId: `u-${id}`,
    workspaceId: CLUB,
    status: 'CONFIRMED',
    sex: 'MALE',
    birthYear: 2000,
    declaredWeightG: null,
    weighedWeightG: 76000,
    weighedAt: STAMP,
    divisionId,
    templateLevelId: null,
    levelName: null,
    levelSetById: null,
    confirmedAt: STAMP,
    withdrawnReason: null,
    place: null as number | null,
    updatedAt: STAMP,
    user: { firstname: 'Иван', lastname },
    workspace: { name: 'ACADEMY' },
    ...o,
})
type EntryFixture = ReturnType<typeof entry>

const NAMES: Record<string, string[]> = {
    a: ['Агеев', 'Белов', 'Волков', 'Гусев', 'Дёмин', 'Ершов', 'Жуков', 'Зуев'],
    b: ['Козлов', 'Лебедев', 'Морозов', 'Новиков', 'Орлов', 'Павлов', 'Романов', 'Соколов'],
}
// Hidden: no tournament-edition consent.
const HIDDEN = new Set(['u-a2', 'u-fin3'])

const fixture = () => {
    const divisions = [
        division('dA', 'Мужчины · до 77 кг', { mat: 1, matOrder: 1, sortOrder: 1 }),
        division('dB', 'Мужчины · до 82 кг', { mat: 1, matOrder: 2, sortOrder: 2 }),
        division('dC', 'Женщины · абсолютная', { mat: 2, matOrder: 1, sortOrder: 3 }),
        division('dU', 'Мужчины · до 90 кг', { sortOrder: 4 }),
        division('dN', 'Мужчины · до 100 кг', { sortOrder: 5, drawNo: 0, drawnAt: null }),
        division('dFIN', 'Мужчины · до 66 кг', { sortOrder: 0, finishedAt: STAMP }),
        division('dW', 'Мужчины · св. 100 кг', { sortOrder: 6, drawNo: 0, drawnAt: null }),
        division('d-other', 'Чужая категория', { tournamentId: OTHER_T }),
    ]
    const entries: EntryFixture[] = [
        ...NAMES.a.map((n, i) => entry(`a${i + 1}`, n, 'dA')),
        ...NAMES.b.map((n, i) => entry(`b${i + 1}`, n, 'dB')),
        entry('c1', 'Титова', 'dC', { sex: 'FEMALE' }),
        entry('c2', 'Уварова', 'dC', { sex: 'FEMALE' }),
        entry('u1', 'Фомин', 'dU'),
        entry('u2', 'Харитонов', 'dU'),
        entry('w1', 'Цветков', 'dW'),
        entry('w2', 'Чернов', 'dW'),
        entry('w3', 'Шишкин', 'dW'),
        entry('w4', 'Щукин', 'dW', { status: 'WITHDRAWN', withdrawnReason: 'Не взвешен' }),
        entry('fin1', 'Юдин', 'dFIN', { place: 1 }),
        entry('fin2', 'Яковлев', 'dFIN', { place: 2 }),
        entry('fin3', 'Абрамов', 'dFIN', { place: 3 }),
        entry('fin4', 'Борисов', 'dFIN', { place: 3 }),
        entry('fin5', 'Быков', 'dFIN'),
        entry('x1', 'Чужой', 'd-other', { tournamentId: OTHER_T, place: 1 }),
    ]
    const matches: MatchFixture[] = [
        ...[1, 2, 3, 4].map((p) => match('dA', 1, p, { entryAId: `a${2 * p - 1}`, entryBId: `a${2 * p}` })),
        match('dA', 2, 1),
        match('dA', 2, 2),
        match('dA', 3, 1),
        match('dB', 1, 1, {
            entryAId: 'b1',
            entryBId: 'b2',
            winnerEntryId: 'b1',
            method: 'FINISH',
            note: 'Удушение сзади',
            decidedAt: STAMP,
        }),
        ...[2, 3, 4].map((p) => match('dB', 1, p, { entryAId: `b${2 * p - 1}`, entryBId: `b${2 * p}` })),
        // Waits for the winner of b3–b4: not ready.
        match('dB', 2, 1, { entryAId: 'b1' }),
        match('dB', 2, 2),
        match('dB', 3, 1),
        match('dC', 1, 1, { entryAId: 'c1', entryBId: 'c2' }),
        match('dU', 1, 1, { entryAId: 'u1', entryBId: 'u2' }),
    ]
    return { divisions, entries, matches }
}

type Where = Record<string, unknown> & {
    tournamentId?: string
    divisionId?: string | { in: string[] }
    id?: { in: string[] }
    place?: { not: null }
}
const inList = (v: unknown, list: { in: string[] } | string | undefined) =>
    list === undefined || (typeof list === 'string' ? v === list : list.in.includes(v as string))

const makePrisma = (o: { role?: Role; tournament?: Record<string, unknown> } = {}) => {
    const db = fixture()
    const tournaments = [
        { id: T, organizationId: ORG },
        { id: OTHER_T, organizationId: OTHER_ORG },
    ]
    const prisma = {
        db,
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
                          status: 'RUNNING',
                          matCount: 2,
                          resultsPublishedAt: null,
                          createdAt: STAMP,
                          updatedAt: STAMP,
                          event: {
                              title: 'Кубок',
                              startAt: STAMP,
                              endAt: null,
                              timezone: 'Asia/Tomsk',
                              place: null,
                              registrationClosesAt: null,
                          },
                          ...o.tournament,
                      }
                    : null
            }),
        },
        tournamentDivision: {
            findMany: jest.fn(async ({ where }: { where: Where }) =>
                db.divisions
                    .filter((d) => d.tournamentId === where.tournamentId && inList(d.id, where.id))
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((d) => ({ ...d })),
            ),
        },
        tournamentEntry: {
            findMany: jest.fn(async ({ where }: { where: Where }) =>
                db.entries
                    .filter(
                        (e) =>
                            e.tournamentId === where.tournamentId &&
                            inList(e.id, where.id) &&
                            inList(e.divisionId, where.divisionId) &&
                            (!where.place || e.place !== null),
                    )
                    .map((e) => ({ ...e })),
            ),
            groupBy: jest.fn(async ({ where }: { where: Where }) => {
                const counts = new Map<string, number>()
                for (const e of db.entries) {
                    if (e.tournamentId !== where.tournamentId || e.status === 'WITHDRAWN') continue
                    if (!e.divisionId || !inList(e.divisionId, where.divisionId)) continue
                    counts.set(e.divisionId, (counts.get(e.divisionId) ?? 0) + 1)
                }
                return [...counts].map(([divisionId, n]) => ({ divisionId, _count: { _all: n } }))
            }),
        },
        tournamentMatch: {
            findMany: jest.fn(async ({ where }: { where: Where }) =>
                db.matches
                    .filter(
                        (m) =>
                            (where.tournamentId === undefined || m.tournamentId === where.tournamentId) &&
                            inList(m.divisionId, where.divisionId),
                    )
                    .sort((a, b) => a.round - b.round || a.position - b.position)
                    .map((m) => ({ ...m })),
            ),
            groupBy: jest.fn(async ({ where }: { where: Where }) => {
                const decided = new Set(
                    db.matches
                        .filter(
                            (m) =>
                                m.tournamentId === where.tournamentId &&
                                !m.isBye &&
                                m.decidedAt !== null &&
                                inList(m.divisionId, where.divisionId),
                        )
                        .map((m) => m.divisionId),
                )
                return [...decided].map((divisionId) => ({ divisionId, _count: { _all: 1 } }))
            }),
        },
        organizationClub: { findMany: jest.fn().mockResolvedValue([{ workspaceId: CLUB }]) },
        consentRecord: {
            findMany: jest.fn(async ({ where }: { where: { OR: Array<{ userId?: { in: string[] } }> } }) =>
                (where.OR[0].userId?.in ?? [])
                    .filter((userId) => !HIDDEN.has(userId))
                    .map((userId) => ({ userId, dependentId: null, version: '2026-11-27.1' })),
            ),
        },
        guardianship: { findMany: jest.fn().mockResolvedValue([]) },
    }
    return prisma
}
type Prisma = ReturnType<typeof makePrisma>
const rbac = (prisma: Prisma) => new OrgRbacService(prisma as never)
const audit = () => ({ record: jest.fn() })
const matchOf = (prisma: Prisma, id: string) => prisma.db.matches.find((m) => m.id === id)!
const divisionOf = (prisma: Prisma, id: string): DivisionFixture => prisma.db.divisions.find((d) => d.id === id)!

type Caller = { prisma?: Prisma; tournamentId?: string; superAdmin?: boolean }

beforeEach(() => {
    jest.mocked(drawDivision).mockReset()
    jest.mocked(recordResult).mockReset()
    jest.mocked(undoResult).mockReset()
    jest.mocked(notifyMatchSoon).mockClear()
})

// ─── drawTournamentDivision ──────────────────────────────────────────────

// What drawDivision writes for «W» (3 entrants, w4 withdrawn): a 4-bracket,
// w3 through on a bye.
const fakeDraw = (prisma: Prisma, drawNo = 1) =>
    jest.mocked(drawDivision).mockImplementation(async (_tx, p) => {
        Object.assign(divisionOf(prisma, p.divisionId), { drawnAt: p.now, drawNo })
        prisma.db.matches.push(
            match(p.divisionId, 1, 1, { entryAId: 'w1', entryBId: 'w2' }),
            match(p.divisionId, 1, 2, { entryAId: 'w3', isBye: true, winnerEntryId: 'w3', decidedAt: p.now }),
            match(p.divisionId, 2, 1, { entryBId: 'w3' }),
        )
        return { drawNo, entries: 3 }
    })

describe('drawTournamentDivision', () => {
    const draw = (divisionId: string, o: Caller & { a?: ReturnType<typeof audit> } = {}) => {
        const prisma = o.prisma ?? makePrisma()
        return new DrawTournamentDivisionHandler(prisma as never, rbac(prisma), (o.a ?? audit()) as never).execute(
            new DrawTournamentDivisionFeature(ORG, o.tournamentId ?? T, divisionId, 'coach', o.superAdmin ?? false),
        )
    }

    it('draws the division and answers the new bracket, audited with the draw number', async () => {
        const prisma = makePrisma()
        fakeDraw(prisma)
        const a = audit()
        const out = await draw('dW', { prisma, a })
        const args = jest.mocked(drawDivision).mock.calls[0]
        expect(args[0]).toBe(prisma)
        expect(args[1]).toEqual({ tournamentId: T, divisionId: 'dW', now: expect.any(Date) })
        expect(out.division).toMatchObject({ id: 'dW', state: 'DRAWN', drawNo: 1, entryCount: 3, hasResults: false })
        expect(out).toMatchObject({ size: 4, rounds: 2, entries: [] })
        expect(out.matches.map((m) => [m.id, m.ready, m.nextMatchId])).toEqual([
            ['dW-1-1', true, 'dW-2-1'],
            ['dW-1-2', false, 'dW-2-1'],
            ['dW-2-1', false, null],
        ])
        expect(out.matches[1]).toMatchObject({ isBye: true, entryA: { entryId: 'w3', personName: 'Иван Шишкин' }, entryB: null })
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.draw',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'coach',
            metadata: { tournamentId: T, divisionId: 'dW', divisionName: 'Мужчины · св. 100 кг', drawNo: 1 },
        })
    })

    it('re-draws («Пережеребить») with the draw number the store returns', async () => {
        const prisma = makePrisma()
        fakeDraw(prisma, 3)
        const a = audit()
        const out = await draw('dW', { prisma, a })
        expect(out.division.drawNo).toBe(3)
        expect(a.record.mock.calls[0][0].metadata.drawNo).toBe(3)
    })

    it('passes the store refusal on (a result is in), no audit', async () => {
        jest.mocked(drawDivision).mockRejectedValue(new BadRequestError({ message: 'Есть результаты' }))
        const a = audit()
        await expect(draw('dA', { a })).rejects.toBeInstanceOf(BadRequestError)
        expect(a.record).not.toHaveBeenCalled()
    })

    it('answers 404 for a division of another tournament and draws nothing', async () => {
        const a = audit()
        await expect(draw('d-other', { a })).rejects.toBeInstanceOf(NotFoundError)
        expect(drawDivision).not.toHaveBeenCalled()
        expect(a.record).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's tournament", async () => {
        await expect(draw('dW', { tournamentId: OTHER_T })).rejects.toBeInstanceOf(NotFoundError)
        expect(drawDivision).not.toHaveBeenCalled()
    })

    it('answers 404 to a non-member', async () => {
        const prisma = makePrisma({ role: null })
        await expect(draw('dW', { prisma })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournament.findFirst).not.toHaveBeenCalled()
        expect(drawDivision).not.toHaveBeenCalled()
    })

    it('lets an org coach and the super admin draw', async () => {
        const coach = makePrisma({ role: 'ORG_COACH' })
        fakeDraw(coach)
        await expect(draw('dW', { prisma: coach })).resolves.toMatchObject({ size: 4 })
        const admin = makePrisma({ role: null })
        fakeDraw(admin)
        await expect(draw('dW', { prisma: admin, superAdmin: true })).resolves.toMatchObject({ size: 4 })
        expect(admin.organizationMember.findUnique).not.toHaveBeenCalled()
    })
})

// ─── getTournamentBracket ────────────────────────────────────────────────

describe('getTournamentBracket', () => {
    const get = (divisionId: string, o: Caller = {}) => {
        const prisma = o.prisma ?? makePrisma()
        return new GetTournamentBracketHandler(prisma as never, rbac(prisma)).execute(
            new GetTournamentBracketFeature(ORG, o.tournamentId ?? T, divisionId, 'coach', o.superAdmin ?? false),
        )
    }

    it('answers a drawn bracket: rounds, links, hidden names', async () => {
        const out = await get('dA')
        expect(out).toMatchObject({ size: 8, rounds: 3, entries: [] })
        expect(out.division).toMatchObject({ id: 'dA', state: 'DRAWN', entryCount: 8, mat: 1 })
        expect(out.matches).toHaveLength(7)
        expect(out.matches[0]).toMatchObject({
            id: 'dA-1-1',
            ready: true,
            nextMatchId: 'dA-2-1',
            entryA: { entryId: 'a1', hidden: false, personName: 'Иван Агеев', clubName: 'ACADEMY' },
            // «Участник скрыт»: the bracket keeps its shape.
            entryB: { entryId: 'a2', hidden: true, personName: null, clubName: null },
        })
        expect(out.matches[4]).toMatchObject({ id: 'dA-2-1', ready: false, entryA: null, entryB: null, nextMatchId: 'dA-3-1' })
    })

    it('a decided match shows its result and the division is RUNNING', async () => {
        const out = await get('dB')
        expect(out.division).toMatchObject({ state: 'RUNNING', hasResults: true })
        expect(out.matches[0]).toMatchObject({
            winnerEntryId: 'b1',
            method: 'FINISH',
            note: 'Удушение сзади',
            decidedAt: STAMP.toISOString(),
            ready: false,
        })
    })

    it('before the draw lists who waits (not the withdrawn)', async () => {
        const out = await get('dW')
        expect(out).toMatchObject({ size: 0, rounds: 0, matches: [] })
        expect(out.division.state).toBe('NOT_DRAWN')
        expect(out.entries.map((e) => e.entryId)).toEqual(['w1', 'w2', 'w3'])
    })

    it('answers 404 for a division of another tournament', async () => {
        await expect(get('d-other')).rejects.toBeInstanceOf(NotFoundError)
    })

    it("answers 404 for another org's tournament", async () => {
        await expect(get('dA', { tournamentId: OTHER_T })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('answers 404 to a non-member; the super admin passes', async () => {
        await expect(get('dA', { prisma: makePrisma({ role: null }) })).rejects.toBeInstanceOf(NotFoundError)
        await expect(get('dA', { prisma: makePrisma({ role: null }), superAdmin: true })).resolves.toMatchObject({ size: 8 })
        await expect(get('dA', { prisma: makePrisma({ role: 'ORG_COACH' }) })).resolves.toMatchObject({ size: 8 })
    })
})

// ─── getTournamentMatQueue ───────────────────────────────────────────────

describe('getTournamentMatQueue', () => {
    const queue = (mat: number, o: Caller = {}) => {
        const prisma = o.prisma ?? makePrisma()
        return new GetTournamentMatQueueHandler(prisma as never, rbac(prisma)).execute(
            new GetTournamentMatQueueFeature(ORG, o.tournamentId ?? T, mat, 'coach', o.superAdmin ?? false),
        )
    }

    it('answers the match on the mat now and the next five, division by division', async () => {
        const prisma = makePrisma()
        const out = await queue(1, { prisma })
        expect(out.mat).toBe(1)
        expect(out.current).toMatchObject({
            id: 'dA-1-1',
            divisionName: 'Мужчины · до 77 кг',
            ready: true,
            nextMatchId: 'dA-2-1',
            entryA: { entryId: 'a1', personName: 'Иван Агеев' },
            entryB: { entryId: 'a2', hidden: true, personName: null, clubName: null },
        })
        // «A» first (matOrder 1), then «B»; the decided, the waiting and the
        // seventh ready match are not listed.
        expect(out.next.map((m) => m.id)).toEqual(['dA-1-2', 'dA-1-3', 'dA-1-4', 'dB-1-2', 'dB-1-3'])
        expect(out.next[3]).toMatchObject({
            divisionName: 'Мужчины · до 82 кг',
            nextMatchId: 'dB-2-1',
            entryA: { entryId: 'b3' },
            entryB: { entryId: 'b4' },
        })
        // Only the six queued matches' entrants are read.
        const entryWhere = prisma.tournamentEntry.findMany.mock.calls[0][0].where
        expect(entryWhere).toEqual({
            tournamentId: T,
            id: { in: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b3', 'b4', 'b5', 'b6'] },
        })
        expect(prisma.tournamentMatch.findMany.mock.calls[0][0].where).toEqual({ tournamentId: T })
        // «U»: drawn, unfinished, no mat. «N» (not drawn) and «FIN» don't count.
        expect(out.unassignedDivisions).toBe(1)
    })

    it('another mat has its own queue', async () => {
        const out = await queue(2)
        expect(out.current).toMatchObject({ id: 'dC-1-1', divisionName: 'Женщины · абсолютная', nextMatchId: null })
        expect(out.next).toEqual([])
    })

    it('an idle mat answers no current match', async () => {
        const prisma = makePrisma()
        prisma.db.matches.splice(0, prisma.db.matches.length)
        const out = await queue(1, { prisma })
        expect(out).toEqual({ mat: 1, current: null, next: [], unassignedDivisions: 1 })
    })

    it('refuses a mat outside the tournament', async () => {
        await expect(queue(0)).rejects.toBeInstanceOf(BadRequestError)
        await expect(queue(3)).rejects.toBeInstanceOf(BadRequestError)
    })

    it("answers 404 for another org's tournament", async () => {
        await expect(queue(1, { tournamentId: OTHER_T })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('answers 404 to a non-member; an org coach and the super admin pass', async () => {
        const stranger = makePrisma({ role: null })
        await expect(queue(1, { prisma: stranger })).rejects.toBeInstanceOf(NotFoundError)
        expect(stranger.tournamentMatch.findMany).not.toHaveBeenCalled()
        await expect(queue(1, { prisma: makePrisma({ role: 'ORG_COACH' }) })).resolves.toMatchObject({ mat: 1 })
        await expect(queue(1, { prisma: makePrisma({ role: null }), superAdmin: true })).resolves.toMatchObject({ mat: 1 })
    })
})

// ─── recordTournamentMatchResult ─────────────────────────────────────────

// What recordResult writes: the result, the winner into the next match.
const fakeRecord = (prisma: Prisma) =>
    jest.mocked(recordResult).mockImplementation(async (_tx, p) => {
        const m = matchOf(prisma, p.matchId)
        Object.assign(m, { ...p.result, decidedAt: p.now, updatedAt: p.now })
        const next = matchOf(prisma, `${m.divisionId}-${m.round + 1}-${Math.ceil(m.position / 2)}`)
        if (m.position % 2 === 1) next.entryAId = p.result.winnerEntryId
        else next.entryBId = p.result.winnerEntryId
        return { divisionId: m.divisionId, round: m.round, position: m.position, retried: false, finished: false }
    })

describe('recordTournamentMatchResult', () => {
    const notifications = { send: jest.fn() }
    const record = (
        matchId: string,
        payload: Record<string, unknown>,
        o: Caller & { a?: ReturnType<typeof audit> } = {},
    ) => {
        const prisma = o.prisma ?? makePrisma()
        return new RecordTournamentMatchResultHandler(
            prisma as never,
            rbac(prisma),
            (o.a ?? audit()) as never,
            notifications as never,
        ).execute(
            new RecordTournamentMatchResultFeature(
                payload as never,
                ORG,
                o.tournamentId ?? T,
                matchId,
                'secretary',
                o.superAdmin ?? false,
            ),
        )
    }

    it('records the result, advances the winner, audits without names and then notifies the mat', async () => {
        const prisma = makePrisma()
        fakeRecord(prisma)
        const a = audit()
        const out = await record(
            'dA-1-1',
            { winnerEntryId: 'a1', method: 'POINTS', scoreA: 4, scoreB: 2, expectedUpdatedAt: STAMP.toISOString() },
            { prisma, a },
        )
        const [tx, args] = jest.mocked(recordResult).mock.calls[0]
        expect(tx).toBe(prisma)
        expect(args).toEqual({
            tournamentId: T,
            matchId: 'dA-1-1',
            result: { winnerEntryId: 'a1', method: 'POINTS', scoreA: 4, scoreB: 2, note: null },
            expectedUpdatedAt: STAMP.toISOString(),
            actorId: 'secretary',
            now: expect.any(Date),
        })
        expect(out.division).toMatchObject({ id: 'dA', state: 'RUNNING', hasResults: true })
        expect(out.matches[0]).toMatchObject({
            id: 'dA-1-1',
            winnerEntryId: 'a1',
            method: 'POINTS',
            scoreA: 4,
            scoreB: 2,
            ready: false,
            decidedAt: args.now.toISOString(),
        })
        expect(out.matches.find((m) => m.id === 'dA-2-1')).toMatchObject({ entryA: { entryId: 'a1' }, entryB: null })

        const entryRecord = a.record.mock.calls[0][0]
        expect(entryRecord).toEqual({
            action: 'tournament.matchResult',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'secretary',
            metadata: {
                tournamentId: T,
                divisionId: 'dA',
                divisionName: 'Мужчины · до 77 кг',
                matchId: 'dA-1-1',
                round: 1,
                position: 1,
                method: 'POINTS',
            },
        })
        expect(JSON.stringify(entryRecord)).not.toMatch(/Агеев|Белов|a1|a2/)

        expect(notifyMatchSoon).toHaveBeenCalledTimes(1)
        expect(jest.mocked(notifyMatchSoon).mock.calls[0]).toEqual([
            prisma,
            notifications,
            { tournamentId: T, mat: 1, now: args.now },
        ])
        // After the commit, never inside it.
        expect(jest.mocked(recordResult).mock.invocationCallOrder[0]).toBeLessThan(
            jest.mocked(notifyMatchSoon).mock.invocationCallOrder[0],
        )
    })

    it('a finish with its note; omitted scores are stored as null', async () => {
        const prisma = makePrisma()
        fakeRecord(prisma)
        const out = await record('dA-1-2', { winnerEntryId: 'a4', method: 'FINISH', note: 'Рычаг локтя' }, { prisma })
        expect(jest.mocked(recordResult).mock.calls[0][1]).toMatchObject({
            result: { winnerEntryId: 'a4', method: 'FINISH', scoreA: null, scoreB: null, note: 'Рычаг локтя' },
            expectedUpdatedAt: undefined,
        })
        expect(out.matches.find((m) => m.id === 'dA-2-1')).toMatchObject({ entryB: { entryId: 'a4' } })
    })

    it('an identical retry answers the bracket without a second audit or notification', async () => {
        const prisma = makePrisma()
        jest.mocked(recordResult).mockResolvedValue({
            divisionId: 'dB',
            round: 1,
            position: 1,
            retried: true,
            finished: false,
        })
        const a = audit()
        const out = await record('dB-1-1', { winnerEntryId: 'b1', method: 'FINISH', note: 'Удушение сзади' }, { prisma, a })
        expect(out.matches[0]).toMatchObject({ id: 'dB-1-1', winnerEntryId: 'b1' })
        expect(a.record).not.toHaveBeenCalled()
        expect(notifyMatchSoon).not.toHaveBeenCalled()
    })

    it('a division without a mat notifies with mat = null (nobody queued)', async () => {
        const prisma = makePrisma()
        jest.mocked(recordResult).mockImplementation(async (_tx, p) => {
            Object.assign(matchOf(prisma, p.matchId), { ...p.result, decidedAt: p.now })
            divisionOf(prisma, 'dU').finishedAt = p.now
            return { divisionId: 'dU', round: 1, position: 1, retried: false, finished: true }
        })
        const out = await record('dU-1-1', { winnerEntryId: 'u1', method: 'DECISION' }, { prisma })
        expect(out.division).toMatchObject({ id: 'dU', state: 'FINISHED' })
        expect(jest.mocked(notifyMatchSoon).mock.calls[0][2]).toMatchObject({ tournamentId: T, mat: null })
    })

    it('a second tablet gets STALE_UPDATE: no audit, no notification', async () => {
        jest.mocked(recordResult).mockRejectedValue(new StaleUpdateError())
        const a = audit()
        await expect(
            record('dB-1-1', { winnerEntryId: 'b2', method: 'POINTS', expectedUpdatedAt: STAMP.toISOString() }, { a }),
        ).rejects.toBeInstanceOf(StaleUpdateError)
        expect(a.record).not.toHaveBeenCalled()
        expect(notifyMatchSoon).not.toHaveBeenCalled()
    })

    it('passes the store 404 on (a match of another tournament)', async () => {
        jest.mocked(recordResult).mockRejectedValue(new NotFoundError({ message: 'Схватка не найдена' }))
        const a = audit()
        await expect(record('m-elsewhere', { winnerEntryId: 'a1', method: 'POINTS' }, { a })).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(a.record).not.toHaveBeenCalled()
        expect(notifyMatchSoon).not.toHaveBeenCalled()
    })

    it("answers 404 for another org's tournament", async () => {
        await expect(
            record('dA-1-1', { winnerEntryId: 'a1', method: 'POINTS' }, { tournamentId: OTHER_T }),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(recordResult).not.toHaveBeenCalled()
        expect(notifyMatchSoon).not.toHaveBeenCalled()
    })

    it('answers 404 to a non-member', async () => {
        const prisma = makePrisma({ role: null })
        await expect(record('dA-1-1', { winnerEntryId: 'a1', method: 'POINTS' }, { prisma })).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(recordResult).not.toHaveBeenCalled()
    })

    it('lets an org coach and the super admin record', async () => {
        const coach = makePrisma({ role: 'ORG_COACH' })
        fakeRecord(coach)
        await expect(record('dA-1-1', { winnerEntryId: 'a1', method: 'POINTS' }, { prisma: coach })).resolves.toMatchObject({
            division: { id: 'dA' },
        })
        const admin = makePrisma({ role: null })
        fakeRecord(admin)
        await expect(
            record('dA-1-1', { winnerEntryId: 'a1', method: 'POINTS' }, { prisma: admin, superAdmin: true }),
        ).resolves.toMatchObject({ division: { id: 'dA' } })
        expect(admin.organizationMember.findUnique).not.toHaveBeenCalled()
    })
})

// ─── undoTournamentMatchResult ───────────────────────────────────────────

// What undoResult writes: the result cleared, the winner out of the next match.
const fakeUndo = (prisma: Prisma) =>
    jest.mocked(undoResult).mockImplementation(async (_tx, p) => {
        const m = matchOf(prisma, p.matchId)
        const previous = {
            winnerEntryId: m.winnerEntryId!,
            method: m.method as 'FINISH',
            scoreA: m.scoreA,
            scoreB: m.scoreB,
        }
        Object.assign(m, { winnerEntryId: null, method: null, scoreA: null, scoreB: null, note: null, decidedAt: null })
        matchOf(prisma, `${m.divisionId}-${m.round + 1}-${Math.ceil(m.position / 2)}`).entryAId = null
        return { divisionId: m.divisionId, round: m.round, position: m.position, previous }
    })

describe('undoTournamentMatchResult', () => {
    const undo = (matchId: string, payload: Record<string, unknown>, o: Caller & { a?: ReturnType<typeof audit> } = {}) => {
        const prisma = o.prisma ?? makePrisma()
        return new UndoTournamentMatchResultHandler(prisma as never, rbac(prisma), (o.a ?? audit()) as never).execute(
            new UndoTournamentMatchResultFeature(payload, ORG, o.tournamentId ?? T, matchId, 'secretary', o.superAdmin ?? false),
        )
    }

    it('clears the result, reopens the match and audits the undone result', async () => {
        const prisma = makePrisma()
        fakeUndo(prisma)
        const a = audit()
        const out = await undo('dB-1-1', { expectedUpdatedAt: STAMP.toISOString() }, { prisma, a })
        expect(jest.mocked(undoResult).mock.calls[0]).toEqual([
            prisma,
            { tournamentId: T, matchId: 'dB-1-1', expectedUpdatedAt: STAMP.toISOString(), now: expect.any(Date) },
        ])
        expect(out.division).toMatchObject({ id: 'dB', state: 'DRAWN', hasResults: false })
        expect(out.matches[0]).toMatchObject({ id: 'dB-1-1', winnerEntryId: null, method: null, ready: true })
        expect(out.matches.find((m) => m.id === 'dB-2-1')).toMatchObject({ entryA: null })
        expect(a.record.mock.calls[0][0]).toEqual({
            action: 'tournament.matchUndo',
            targetType: 'tournament',
            targetId: T,
            organizationId: ORG,
            actorId: 'secretary',
            metadata: {
                tournamentId: T,
                divisionId: 'dB',
                divisionName: 'Мужчины · до 82 кг',
                matchId: 'dB-1-1',
                round: 1,
                position: 1,
                previous: { winnerEntryId: 'b1', method: 'FINISH', scoreA: null, scoreB: null },
            },
        })
    })

    it('passes the store refusal on (not at the frontier / stale), no audit', async () => {
        jest.mocked(undoResult).mockRejectedValue(new StaleUpdateError())
        const a = audit()
        await expect(undo('dB-1-1', { expectedUpdatedAt: STAMP.toISOString() }, { a })).rejects.toBeInstanceOf(
            StaleUpdateError,
        )
        jest.mocked(undoResult).mockRejectedValue(new BadRequestError({ message: 'Результат этой схватки не записан' }))
        await expect(undo('dA-1-1', {}, { a })).rejects.toBeInstanceOf(BadRequestError)
        expect(a.record).not.toHaveBeenCalled()
    })

    it('passes the store 404 on (a match of another tournament)', async () => {
        jest.mocked(undoResult).mockRejectedValue(new NotFoundError({ message: 'Схватка не найдена' }))
        await expect(undo('m-elsewhere', {})).rejects.toBeInstanceOf(NotFoundError)
    })

    it("answers 404 for another org's tournament", async () => {
        await expect(undo('dB-1-1', {}, { tournamentId: OTHER_T })).rejects.toBeInstanceOf(NotFoundError)
        expect(undoResult).not.toHaveBeenCalled()
    })

    it('answers 404 to a non-member', async () => {
        await expect(undo('dB-1-1', {}, { prisma: makePrisma({ role: null }) })).rejects.toBeInstanceOf(NotFoundError)
        expect(undoResult).not.toHaveBeenCalled()
    })

    it('lets an org coach and the super admin undo', async () => {
        const coach = makePrisma({ role: 'ORG_COACH' })
        fakeUndo(coach)
        await expect(undo('dB-1-1', {}, { prisma: coach })).resolves.toMatchObject({ division: { id: 'dB' } })
        const admin = makePrisma({ role: null })
        fakeUndo(admin)
        await expect(undo('dB-1-1', {}, { prisma: admin, superAdmin: true })).resolves.toMatchObject({
            division: { id: 'dB' },
        })
    })
})

// ─── getTournamentResults ────────────────────────────────────────────────

describe('getTournamentResults', () => {
    const results = (o: Caller = {}) => {
        const prisma = o.prisma ?? makePrisma()
        return new GetTournamentResultsHandler(prisma as never, rbac(prisma)).execute(
            new GetTournamentResultsFeature(ORG, o.tournamentId ?? T, 'coach', o.superAdmin ?? false),
        )
    }

    it('answers podiums per division in order; unfinished ones have none', async () => {
        const prisma = makePrisma()
        const out = await results({ prisma })
        expect(out).toMatchObject({ status: 'RUNNING', resultsPublishedAt: null })
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toEqual({
            tournamentId: T,
            place: { not: null },
        })
        expect(out.divisions.map((d) => [d.divisionId, d.drawn, d.finished, d.podium.length])).toEqual([
            ['dFIN', true, true, 4],
            ['dA', true, false, 0],
            ['dB', true, false, 0],
            ['dC', true, false, 0],
            ['dU', true, false, 0],
            ['dN', false, false, 0],
            ['dW', false, false, 0],
        ])
        expect(out.divisions[0]).toMatchObject({ name: 'Мужчины · до 66 кг' })
        expect(out.divisions[0].podium).toEqual([
            { place: 1, entryId: 'fin1', hidden: false, personName: 'Иван Юдин', clubName: 'ACADEMY' },
            { place: 2, entryId: 'fin2', hidden: false, personName: 'Иван Яковлев', clubName: 'ACADEMY' },
            { place: 3, entryId: 'fin4', hidden: false, personName: 'Иван Борисов', clubName: 'ACADEMY' },
            // «Участник скрыт»: the place stays, the name and club don't.
            { place: 3, entryId: 'fin3', hidden: true, personName: null, clubName: null },
        ])
    })

    it('a published tournament says when', async () => {
        const at = new Date('2026-12-20T12:00:00Z')
        const out = await results({ prisma: makePrisma({ tournament: { status: 'FINISHED', resultsPublishedAt: at } }) })
        expect(out).toMatchObject({ status: 'FINISHED', resultsPublishedAt: at.toISOString() })
    })

    it("answers 404 for another org's tournament", async () => {
        const prisma = makePrisma()
        await expect(results({ prisma, tournamentId: OTHER_T })).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tournamentEntry.findMany).not.toHaveBeenCalled()
    })

    it('answers 404 to a non-member; an org coach and the super admin pass', async () => {
        await expect(results({ prisma: makePrisma({ role: null }) })).rejects.toBeInstanceOf(NotFoundError)
        await expect(results({ prisma: makePrisma({ role: 'ORG_COACH' }) })).resolves.toMatchObject({ status: 'RUNNING' })
        const admin = makePrisma({ role: null })
        await expect(results({ prisma: admin, superAdmin: true })).resolves.toMatchObject({ status: 'RUNNING' })
        expect(admin.organizationMember.findUnique).not.toHaveBeenCalled()
    })
})
