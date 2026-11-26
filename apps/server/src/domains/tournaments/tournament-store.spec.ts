import { StaleUpdateError } from '../../shared/errors/shared.errors'
import { bracketSize } from './bracket'
import {
    confirmEntry,
    declareEntry,
    drawDivision,
    moveEntry,
    NOT_WEIGHED_REASON,
    recordResult,
    recordWeighIn,
    releaseRegistrationEntry,
    type ResultInput,
    setEntryWithdrawn,
    setResultsPublished,
    setTournamentStatus,
    undoResult,
} from './tournament-store'

// ─── An in-memory Prisma for the store ───────────────────────────────────
// Implements the slice of the client the store uses, with real semantics
// where they matter: `SELECT … FOR UPDATE` row locks held until the
// transaction ends, a rollback of the transaction's own writes on a throw,
// and `@updatedAt` bumped on every write. So the specs assert on what the
// store wrote, and two concurrent calls interleave at every await exactly as
// far as the locks let them.

type Row = Record<string, unknown> & { id: string }
type Where = Record<string, unknown>

const T = 't1'
const NOW = new Date('2026-12-20T05:00:00Z')

const same = (a: unknown, b: unknown): boolean =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b

const matches = (row: Row, where: Where | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k === 'OR') return (v as Where[]).some((w) => matches(row, w))
        if (k === 'divisionId_round_position') return matches(row, v as Where)
        const cell = row[k] ?? null
        if (v === null) return cell === null
        if (v instanceof Date || typeof v !== 'object') return same(cell, v)
        const op = v as { not?: unknown; in?: unknown[] }
        if ('not' in op) return op.not === null ? cell !== null : !same(cell, op.not)
        if ('in' in op) return (op.in ?? []).includes(cell)
        throw new Error(`fake prisma: unsupported filter ${k}`)
    })

const world = () => {
    let clock = NOW.getTime()
    const tick = () => new Date((clock += 1000))
    const tables: Record<string, Row[]> = {
        tournament: [],
        tournamentDivision: [],
        tournamentEntry: [],
        tournamentMatch: [],
    }
    let seq = 0
    const held = new Map<string, Promise<void>>()
    const lockLog: string[] = []

    const client = (tx: { locks: Array<() => void>; ids: Set<string>; undo: Array<() => void> } | null) => {
        const remember = (table: string, before: Row | undefined, id: string) => {
            if (!tx) return
            tx.undo.push(() => {
                const rows = tables[table]
                const i = rows.findIndex((r) => r.id === id)
                if (before) {
                    if (i >= 0) rows[i] = before
                    else rows.push(before)
                } else if (i >= 0) rows.splice(i, 1)
            })
        }
        const write = (table: string, row: Row, data: Record<string, unknown>) => {
            remember(table, { ...row }, row.id)
            for (const [k, v] of Object.entries(data)) {
                if (v && typeof v === 'object' && 'increment' in (v as object)) {
                    row[k] = (row[k] as number) + (v as { increment: number }).increment
                } else row[k] = v
            }
            if (!('updatedAt' in data)) row.updatedAt = tick()
            return row
        }
        const pick = (row: Row, select?: Record<string, unknown>) => {
            const out: Row = { ...row }
            const count = (select?._count as { select?: Record<string, { where?: Where }> } | undefined)
                ?.select
            if (count?.entries) {
                out._count = {
                    entries: tables.tournamentEntry.filter(
                        (e) => e.divisionId === row.id && matches(e, count.entries.where),
                    ).length,
                }
            }
            return out
        }
        const model = (table: string) => ({
            findMany: async (a: { where?: Where; select?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> } = {}) => {
                const rows = tables[table].filter((r) => matches(r, a.where))
                const [key, dir] = Object.entries(a.orderBy ?? {})[0] ?? []
                if (key) {
                    rows.sort((x, y) => ((x[key] as number) - (y[key] as number)) * (dir === 'desc' ? -1 : 1))
                }
                return rows.map((r) => pick(r, a.select))
            },
            findFirst: async (a: { where?: Where }) => {
                const r = tables[table].find((x) => matches(x, a.where))
                return r ? { ...r } : null
            },
            findUnique: async (a: { where: Where }) => {
                const r = tables[table].find((x) => matches(x, a.where))
                return r ? { ...r } : null
            },
            findUniqueOrThrow: async (a: { where: Where }) => {
                const r = tables[table].find((x) => matches(x, a.where))
                if (!r) throw new Error('fake prisma: not found')
                return { ...r }
            },
            count: async (a: { where?: Where }) => tables[table].filter((r) => matches(r, a.where)).length,
            groupBy: async (a: { by: string[]; where?: Where }) => {
                const groups = new Map<unknown, number>()
                for (const r of tables[table].filter((x) => matches(x, a.where))) {
                    groups.set(r[a.by[0]], (groups.get(r[a.by[0]]) ?? 0) + 1)
                }
                return [...groups].map(([k, n]) => ({ [a.by[0]]: k, _count: { _all: n } }))
            },
            create: async (a: { data: Record<string, unknown> }) => {
                const row: Row = { id: `${table}-${++seq}`, ...defaults(table), ...a.data, updatedAt: tick() }
                tables[table].push(row)
                remember(table, undefined, row.id)
                return { ...row }
            },
            createMany: async (a: { data: Array<Record<string, unknown>> }) => {
                for (const d of a.data) {
                    const row: Row = { id: `${table}-${++seq}`, ...defaults(table), ...d, updatedAt: tick() }
                    tables[table].push(row)
                    remember(table, undefined, row.id)
                }
                return { count: a.data.length }
            },
            update: async (a: { where: Where; data: Record<string, unknown> }) => {
                const r = tables[table].find((x) => matches(x, a.where))
                if (!r) throw new Error(`fake prisma: ${table}.update found no row`)
                return { ...write(table, r, a.data) }
            },
            updateMany: async (a: { where?: Where; data: Record<string, unknown> }) => {
                const rows = tables[table].filter((r) => matches(r, a.where))
                for (const r of rows) write(table, r, a.data)
                return { count: rows.length }
            },
            deleteMany: async (a: { where?: Where }) => {
                const rows = tables[table].filter((r) => matches(r, a.where))
                for (const r of rows) {
                    remember(table, { ...r }, r.id)
                    tables[table].splice(tables[table].indexOf(r), 1)
                }
                return { count: rows.length }
            },
        })
        const lock = async (id: string) => {
            if (!tx) throw new Error('fake prisma: FOR UPDATE outside a transaction')
            if (tx.ids.has(id)) return
            while (held.has(id)) await held.get(id)
            const { promise, resolve } = Promise.withResolvers<void>()
            held.set(id, promise)
            tx.ids.add(id)
            tx.locks.push(() => {
                held.delete(id)
                resolve()
            })
        }
        return {
            tournament: model('tournament'),
            tournamentDivision: model('tournamentDivision'),
            tournamentEntry: model('tournamentEntry'),
            tournamentMatch: model('tournamentMatch'),
            $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
                const text = sql.join('?')
                if (!text.includes('FOR UPDATE')) throw new Error('fake prisma: unexpected raw query')
                const id = values[0] as string
                const table = text.includes('"TournamentDivision"') ? 'tournamentDivision' : 'tournament'
                const row = tables[table].find((r) => r.id === id)
                if (!row) return []
                lockLog.push(`${table}:${id}`)
                await lock(id)
                const fresh = tables[table].find((r) => r.id === id)!
                return [table === 'tournament' ? { status: fresh.status } : { id }]
            },
        }
    }
    const defaults = (table: string): Record<string, unknown> =>
        table === 'tournamentEntry'
            ? {
                  divisionId: null,
                  status: 'DECLARED',
                  confirmedAt: null,
                  confirmedById: null,
                  weighedWeightG: null,
                  place: null,
                  withdrawnReason: null,
                  templateLevelId: null,
                  levelName: null,
                  levelSetById: null,
              }
            : table === 'tournamentMatch'
              ? { method: null, scoreA: null, scoreB: null, note: null, decidedById: null }
              : {}

    const root = client(null)
    const prisma = {
        ...root,
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
            const tx = { locks: [] as Array<() => void>, ids: new Set<string>(), undo: [] as Array<() => void> }
            try {
                return await fn(client(tx))
            } catch (e) {
                for (const undo of tx.undo.reverse()) undo()
                throw e
            } finally {
                for (const release of tx.locks) release()
            }
        }),
    }
    return { prisma, tables, lockLog }
}

type World = ReturnType<typeof world>

const tournament = (w: World, status: string, o: Record<string, unknown> = {}) =>
    w.tables.tournament.push({ id: T, eventId: 'ev1', status, resultsPublishedAt: null, ...o })

const division = (w: World, id: string, o: Record<string, unknown> = {}) =>
    w.tables.tournamentDivision.push({
        id,
        tournamentId: T,
        name: `Категория ${id}`,
        sortOrder: w.tables.tournamentDivision.length + 1,
        weightMinG: null,
        weightMaxG: null,
        mat: 1,
        drawNo: 0,
        drawnAt: null,
        finishedAt: null,
        ...o,
    })

// A confirmed, weighed entrant (drawable) unless overridden.
const entry = (w: World, id: string, o: Record<string, unknown> = {}) =>
    w.tables.tournamentEntry.push({
        id,
        tournamentId: T,
        registrationId: `reg-${id}`,
        userId: `user-${id}`,
        workspaceId: 'club-a',
        divisionId: 'd1',
        status: 'CONFIRMED',
        sex: 'MALE',
        birthYear: 2000,
        declaredWeightG: 75_000,
        weighedWeightG: 75_500,
        confirmedAt: NOW,
        confirmedById: 'coach',
        place: null,
        withdrawnReason: null,
        ...o,
    })

const matchesOf = (w: World, divisionId = 'd1') =>
    w.tables.tournamentMatch
        .filter((m) => m.divisionId === divisionId)
        .sort((a, b) => (a.round as number) - (b.round as number) || (a.position as number) - (b.position as number))

const at = (w: World, round: number, position: number, divisionId = 'd1') =>
    matchesOf(w, divisionId).find((m) => m.round === round && m.position === position)!

const readyOf = (w: World, divisionId = 'd1') =>
    matchesOf(w, divisionId).filter(
        (m) => !m.isBye && m.entryAId && m.entryBId && m.winnerEntryId === null,
    )

const placeOf = (w: World, id: string) => w.tables.tournamentEntry.find((e) => e.id === id)!.place
const entryRow = (w: World, id: string) => w.tables.tournamentEntry.find((e) => e.id === id)!
const divisionRow = (w: World, id = 'd1') => w.tables.tournamentDivision.find((d) => d.id === id)!

const win = (
    m: Row,
    side: 'A' | 'B' = 'A',
    o: Partial<ResultInput> = {},
): ResultInput => ({
    winnerEntryId: (side === 'A' ? m.entryAId : m.entryBId) as string,
    method: 'POINTS',
    scoreA: 4,
    scoreB: 2,
    note: null,
    ...o,
})

const record = (w: World, m: Row, result: ResultInput, expectedUpdatedAt?: string) =>
    recordResult(w.prisma as never, {
        tournamentId: T,
        matchId: m.id,
        result,
        expectedUpdatedAt,
        actorId: 'secretary',
        now: NOW,
    })

const undo = (w: World, m: Row, expectedUpdatedAt?: string) =>
    undoResult(w.prisma as never, { tournamentId: T, matchId: m.id, expectedUpdatedAt, now: NOW })

// A running tournament with `n` drawn entrants in d1 (clubs alternate a/b
// unless all teammates).
const running = async (n: number, o: { clubs?: string[] } = {}) => {
    const w = world()
    tournament(w, 'WEIGH_IN')
    division(w, 'd1')
    const clubs = o.clubs ?? ['club-a', 'club-b']
    for (let i = 1; i <= n; i += 1) entry(w, `e${i}`, { workspaceId: clubs[i % clubs.length] })
    await drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'd1', now: NOW })
    w.tables.tournament[0].status = 'RUNNING'
    return w
}

// Plays the whole division, side A always winning.
const playOut = async (w: World, divisionId = 'd1') => {
    for (let guard = 0; guard < 64; guard += 1) {
        const [m] = readyOf(w, divisionId)
        if (!m) return
        await record(w, m, win(m))
    }
}

describe('draw', () => {
    it('writes every round, resolves three byes for five entrants and stamps drawNo/drawnAt', async () => {
        const w = await running(5)
        const all = matchesOf(w)
        expect(bracketSize(5)).toBe(8)
        expect(all.map((m) => `${m.round}:${m.position}`)).toEqual([
            '1:1', '1:2', '1:3', '1:4', '2:1', '2:2', '3:1',
        ])
        const byes = all.filter((m) => m.isBye)
        expect(byes).toHaveLength(3)
        for (const b of byes) {
            // never two byes in a pair; the athlete is the winner at once
            expect([b.entryAId, b.entryBId].filter(Boolean)).toHaveLength(1)
            expect(b.winnerEntryId).toBe(b.entryAId ?? b.entryBId)
            expect(b.decidedAt).toEqual(NOW)
            // and already sits in the next round
            const next = at(w, 2, Math.ceil((b.position as number) / 2))
            expect([next.entryAId, next.entryBId]).toContain(b.winnerEntryId)
        }
        const seeded = all.filter((m) => m.round === 1).flatMap((m) => [m.entryAId, m.entryBId])
        expect(seeded.filter(Boolean).sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
        expect(divisionRow(w)).toMatchObject({ drawNo: 1, drawnAt: NOW, finishedAt: null })
        expect(w.lockLog).toEqual([`tournament:${T}`, 'tournamentDivision:d1'])
    })

    it('keeps two teammates apart until the final', async () => {
        const w = await running(4, { clubs: ['club-a', 'club-a', 'club-b', 'club-c'] })
        const [m1, m2] = matchesOf(w).filter((m) => m.round === 1)
        const clubOf = (id: unknown) => entryRow(w, id as string).workspaceId
        // e2 and e4 share club-a (i % 4 → 2 and 0): one per semifinal
        const sides = [m1, m2].map((m) => [clubOf(m.entryAId), clubOf(m.entryBId)])
        expect(sides[0].filter((c) => c === 'club-a')).toHaveLength(1)
        expect(sides[1].filter((c) => c === 'club-a')).toHaveLength(1)
    })

    it('gives a lone athlete 1st place at once («без соперника»)', async () => {
        const w = await running(1)
        expect(matchesOf(w)).toHaveLength(0)
        expect(placeOf(w, 'e1')).toBe(1)
        expect(divisionRow(w).finishedAt).toEqual(NOW)
    })

    it('draws only confirmed, weighed entrants of the division', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        division(w, 'd2')
        entry(w, 'a')
        entry(w, 'b')
        entry(w, 'unweighed', { weighedWeightG: null })
        entry(w, 'declared', { status: 'DECLARED' })
        entry(w, 'gone', { status: 'WITHDRAWN' })
        entry(w, 'other', { divisionId: 'd2' })
        await expect(
            drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'd1', now: NOW }),
        ).resolves.toEqual({ drawNo: 1, entries: 2 })
        expect(matchesOf(w)).toHaveLength(1)
        expect([at(w, 1, 1).entryAId, at(w, 1, 1).entryBId].sort()).toEqual(['a', 'b'])
    })

    it('redraws without results: a new salt, the old matches replaced', async () => {
        const w = await running(6)
        const before = matchesOf(w).map((m) => m.id)
        await drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'd1', now: NOW })
        expect(divisionRow(w).drawNo).toBe(2)
        expect(matchesOf(w)).toHaveLength(7)
        expect(matchesOf(w).some((m) => before.includes(m.id))).toBe(false)
    })

    it('refuses a redraw once a non-bye match is decided (409 DIVISION_HAS_RESULTS)', async () => {
        const w = await running(4)
        await record(w, at(w, 1, 1), win(at(w, 1, 1)))
        const snapshot = JSON.stringify(matchesOf(w))
        await expect(
            drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'd1', now: NOW }),
        ).rejects.toMatchObject({ code: 'DIVISION_HAS_RESULTS', statusCode: 409 })
        expect(JSON.stringify(matchesOf(w))).toBe(snapshot)
    })

    it('refuses before the weigh-in, after publication, without entrants and over 64', async () => {
        const w = world()
        tournament(w, 'SETUP')
        division(w, 'd1')
        entry(w, 'a')
        const draw = () => drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'd1', now: NOW })
        await expect(draw()).rejects.toMatchObject({ statusCode: 400 })
        w.tables.tournament[0].status = 'FINISHED'
        await expect(draw()).rejects.toMatchObject({ code: 'TOURNAMENT_PUBLISHED' })
        w.tables.tournament[0].status = 'WEIGH_IN'
        w.tables.tournamentEntry.length = 0
        await expect(draw()).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/нет взвешенных/) })
        for (let i = 0; i < 65; i += 1) entry(w, `x${i}`)
        await expect(draw()).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/разделите/) })
        expect(matchesOf(w)).toHaveLength(0)
    })

    it('404s an unknown tournament or division', async () => {
        const w = world()
        await expect(
            drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'd1', now: NOW }),
        ).rejects.toMatchObject({ statusCode: 404 })
        tournament(w, 'WEIGH_IN')
        await expect(
            drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'nope', now: NOW }),
        ).rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('phase changes', () => {
    const go = (w: World, to: 'SETUP' | 'WEIGH_IN' | 'RUNNING') =>
        setTournamentStatus(w.prisma as never, { tournamentId: T, to, now: NOW })

    it('moves SETUP ↔ WEIGH_IN and answers a no-op for the current status', async () => {
        const w = world()
        tournament(w, 'SETUP')
        await expect(go(w, 'WEIGH_IN')).resolves.toEqual({ from: 'SETUP', withdrawn: 0, drawn: 0 })
        expect(w.tables.tournament[0].status).toBe('WEIGH_IN')
        await expect(go(w, 'SETUP')).resolves.toMatchObject({ from: 'WEIGH_IN' })
        expect(w.tables.tournament[0].status).toBe('SETUP')
        await expect(go(w, 'SETUP')).resolves.toEqual({ from: 'SETUP', withdrawn: 0, drawn: 0 })
    })

    it('refuses transitions out of order', async () => {
        const w = world()
        tournament(w, 'SETUP')
        await expect(go(w, 'RUNNING')).rejects.toMatchObject({ statusCode: 400 })
        w.tables.tournament[0].status = 'RUNNING'
        await expect(go(w, 'WEIGH_IN')).rejects.toMatchObject({ statusCode: 400 })
        await expect(go(w, 'SETUP')).rejects.toMatchObject({ statusCode: 400 })
        w.tables.tournament[0].status = 'FINISHED'
        await expect(go(w, 'RUNNING')).rejects.toMatchObject({ code: 'TOURNAMENT_PUBLISHED' })
    })

    it('starts: withdraws the unweighed «Не взвешен», draws every undrawn division with entrants', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        division(w, 'd2')
        division(w, 'empty')
        division(w, 'drawn', { drawnAt: new Date('2026-12-20T04:00:00Z'), drawNo: 3 })
        entry(w, 'a')
        entry(w, 'b')
        entry(w, 'c', { divisionId: 'd2' })
        entry(w, 'x', { divisionId: 'drawn' })
        entry(w, 'noshow', { weighedWeightG: null })
        entry(w, 'declared', { status: 'DECLARED', weighedWeightG: null, divisionId: null })
        entry(w, 'gone', { status: 'WITHDRAWN', weighedWeightG: null, withdrawnReason: 'Травма' })

        await expect(go(w, 'RUNNING')).resolves.toEqual({ from: 'WEIGH_IN', withdrawn: 2, drawn: 2 })

        expect(w.tables.tournament[0].status).toBe('RUNNING')
        expect(entryRow(w, 'noshow')).toMatchObject({ status: 'WITHDRAWN', withdrawnReason: NOT_WEIGHED_REASON })
        expect(entryRow(w, 'declared')).toMatchObject({ status: 'WITHDRAWN', withdrawnReason: NOT_WEIGHED_REASON })
        expect(entryRow(w, 'gone').withdrawnReason).toBe('Травма')
        expect(matchesOf(w, 'd1')).toHaveLength(1)
        expect(placeOf(w, 'c')).toBe(1)
        expect(divisionRow(w, 'empty').drawnAt).toBeNull()
        // an already drawn division keeps its bracket
        expect(divisionRow(w, 'drawn').drawNo).toBe(3)
    })

    it('refuses the start while a weighed entrant has no division (409 TOURNAMENT_UNASSIGNED)', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        entry(w, 'a', { divisionId: null })
        entry(w, 'b', { divisionId: null })
        entry(w, 'c', { divisionId: null })
        entry(w, 'noshow', { weighedWeightG: null })
        await expect(go(w, 'RUNNING')).rejects.toMatchObject({
            code: 'TOURNAMENT_UNASSIGNED',
            statusCode: 409,
            message: '3 участника без категории',
        })
        expect(w.tables.tournament[0].status).toBe('WEIGH_IN')
        expect(entryRow(w, 'noshow').status).toBe('CONFIRMED')
    })

    it('refuses the start with a division over 64 and changes nothing', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1', { name: 'Абсолютная' })
        for (let i = 0; i < 65; i += 1) entry(w, `x${i}`)
        entry(w, 'noshow', { weighedWeightG: null })
        await expect(go(w, 'RUNNING')).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('Абсолютная'),
        })
        expect(entryRow(w, 'noshow').status).toBe('CONFIRMED')
        expect(w.tables.tournamentMatch).toHaveLength(0)
    })
})

describe('publication', () => {
    const publish = (w: World, published: boolean) =>
        setResultsPublished(w.prisma as never, { tournamentId: T, published, now: NOW })

    it('publishes once every drawn division is finished and unpublishes back to RUNNING', async () => {
        const w = await running(3)
        division(w, 'unused')
        await playOut(w)
        await expect(publish(w, true)).resolves.toEqual({ changed: true })
        expect(w.tables.tournament[0]).toMatchObject({ status: 'FINISHED', resultsPublishedAt: NOW })
        await expect(publish(w, true)).resolves.toEqual({ changed: false })
        await expect(publish(w, false)).resolves.toEqual({ changed: true })
        expect(w.tables.tournament[0]).toMatchObject({ status: 'RUNNING', resultsPublishedAt: null })
        await expect(publish(w, false)).resolves.toEqual({ changed: false })
    })

    it('refuses with unfinished divisions, counting undrawn ones with entrants', async () => {
        const w = await running(4)
        division(w, 'd2')
        entry(w, 'late', { divisionId: 'd2' })
        await record(w, at(w, 1, 1), win(at(w, 1, 1)))
        await expect(publish(w, true)).rejects.toMatchObject({
            statusCode: 400,
            message: 'Не закончены: 2 категории',
        })
        expect(w.tables.tournament[0].status).toBe('RUNNING')
    })

    it('an unweighed entrant returned after the start does not block publishing', async () => {
        const w = await running(2)
        division(w, 'd2')
        entry(w, 'back', { divisionId: 'd2', weighedWeightG: null })
        await playOut(w)
        await expect(publish(w, true)).resolves.toEqual({ changed: true })
    })

    it('refuses before the start and unpublishing what is not published', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        await expect(publish(w, true)).rejects.toMatchObject({ statusCode: 400 })
        await expect(publish(w, false)).rejects.toMatchObject({ statusCode: 400 })
    })
})

describe('results', () => {
    it('advances the winner into the next slot and settles 1, 2, 3, 3 on the final', async () => {
        const w = await running(4)
        const sf1 = at(w, 1, 1)
        const sf2 = at(w, 1, 2)
        await expect(record(w, sf1, win(sf1, 'B'))).resolves.toEqual({
            divisionId: 'd1',
            round: 1,
            position: 1,
            retried: false,
            finished: false,
        })
        expect(at(w, 1, 1)).toMatchObject({
            winnerEntryId: sf1.entryBId,
            method: 'POINTS',
            scoreA: 4,
            scoreB: 2,
            decidedAt: NOW,
            decidedById: 'secretary',
        })
        expect(at(w, 2, 1)).toMatchObject({ entryAId: sf1.entryBId, entryBId: null })
        await record(w, sf2, win(sf2, 'A'))
        expect(at(w, 2, 1)).toMatchObject({ entryAId: sf1.entryBId, entryBId: sf2.entryAId })
        expect(divisionRow(w).finishedAt).toBeNull()

        const final = at(w, 2, 1)
        await expect(record(w, final, win(final, 'B', { method: 'FINISH', scoreA: null, scoreB: null }))).resolves.toMatchObject({
            round: 2,
            finished: true,
        })
        expect(placeOf(w, sf2.entryAId as string)).toBe(1)
        expect(placeOf(w, sf1.entryBId as string)).toBe(2)
        expect(placeOf(w, sf1.entryAId as string)).toBe(3)
        expect(placeOf(w, sf2.entryBId as string)).toBe(3)
        expect(divisionRow(w).finishedAt).toEqual(NOW)
    })

    it('leaves a semifinal loser by walkover without a place', async () => {
        const w = await running(4)
        const sf1 = at(w, 1, 1)
        await record(w, sf1, win(sf1, 'A', { method: 'WALKOVER', scoreA: null, scoreB: null }))
        await playOut(w)
        expect(placeOf(w, sf1.entryBId as string)).toBeNull()
        expect(w.tables.tournamentEntry.filter((e) => e.place === 3)).toHaveLength(1)
    })

    it('settles a division of three with one bronze, the bye winner meeting the semifinal winner', async () => {
        const w = await running(3)
        await playOut(w)
        expect(w.tables.tournamentEntry.map((e) => e.place).sort()).toEqual([1, 2, 3])
    })

    it('answers an identical retry with 200 whatever expectedUpdatedAt says and writes nothing', async () => {
        const w = await running(4)
        const m = at(w, 1, 1)
        const stamp = (m.updatedAt as Date).toISOString()
        await record(w, m, win(m), stamp)
        const after = JSON.stringify(w.tables)
        await expect(record(w, m, win(m), stamp)).resolves.toMatchObject({ retried: true, finished: false })
        await expect(record(w, m, win(m), '2020-01-01T00:00:00.000Z')).resolves.toMatchObject({ retried: true })
        expect(JSON.stringify(w.tables)).toBe(after)
    })

    it('refuses a different result on a decided match with STALE_UPDATE, with or without expectedUpdatedAt', async () => {
        const w = await running(4)
        const m = at(w, 1, 1)
        await record(w, m, win(m, 'A'))
        await expect(record(w, m, win(m, 'B'))).rejects.toBeInstanceOf(StaleUpdateError)
        await expect(record(w, m, win(m, 'A', { scoreA: 8 }))).rejects.toMatchObject({
            code: 'STALE_UPDATE',
            statusCode: 409,
            message: 'Результат уже записан с другого планшета',
            metadata: { winnerEntryId: m.entryAId, method: 'POINTS', scoreA: 4, scoreB: 2, decidedAt: NOW.toISOString() },
        })
        expect(at(w, 1, 1)).toMatchObject({ winnerEntryId: m.entryAId, scoreA: 4 })
    })

    it('refuses a stale expectedUpdatedAt on an undecided match and writes nothing', async () => {
        const w = await running(4)
        const m = at(w, 1, 1)
        await expect(record(w, m, win(m), '2020-01-01T00:00:00.000Z')).rejects.toMatchObject({
            code: 'STALE_UPDATE',
        })
        expect(at(w, 1, 1)).toMatchObject({ winnerEntryId: null, updatedAt: m.updatedAt })
        expect(at(w, 2, 1).entryAId).toBeNull()
    })

    it('two tablets at once: the row locks let one through, the other gets STALE_UPDATE', async () => {
        const w = await running(4)
        const m = at(w, 1, 1)
        const stamp = (m.updatedAt as Date).toISOString()
        const out = await Promise.allSettled([
            record(w, m, win(m, 'A'), stamp),
            record(w, m, win(m, 'B'), stamp),
        ])
        expect(out.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected'])
        const lost = out.find((o) => o.status === 'rejected') as PromiseRejectedResult
        expect(lost.reason).toBeInstanceOf(StaleUpdateError)
        // exactly one winner in the next round
        expect([at(w, 2, 1).entryAId]).toEqual([at(w, 1, 1).winnerEntryId])
    })

    it('two identical submissions at once: both answer 200, one of them as the retry', async () => {
        const w = await running(4)
        const m = at(w, 1, 1)
        const out = await Promise.all([record(w, m, win(m)), record(w, m, win(m))])
        expect(out.map((o) => o.retried).sort()).toEqual([false, true])
    })

    it('refuses a match not ready, a bye, a stranger as winner and the wrong phase', async () => {
        const w = await running(3)
        const bye = matchesOf(w).find((m) => m.isBye)!
        const waiting = at(w, 2, 1)
        await expect(record(w, bye, win(bye, bye.entryAId ? 'A' : 'B'))).rejects.toMatchObject({ statusCode: 400 })
        await expect(record(w, waiting, { ...win(waiting), winnerEntryId: (waiting.entryAId ?? waiting.entryBId) as string })).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringMatching(/не готова/),
        })
        const [m] = readyOf(w)
        await expect(record(w, m, { ...win(m), winnerEntryId: 'stranger' })).rejects.toMatchObject({ statusCode: 400 })
        await expect(record(w, { ...m, id: 'nope' }, win(m))).rejects.toMatchObject({ statusCode: 404 })
        w.tables.tournament[0].status = 'WEIGH_IN'
        await expect(record(w, m, win(m))).rejects.toMatchObject({ statusCode: 400 })
        w.tables.tournament[0].status = 'FINISHED'
        await expect(record(w, m, win(m))).rejects.toMatchObject({ code: 'TOURNAMENT_PUBLISHED' })
    })
})

describe('undo', () => {
    it('is blocked while the next match is decided and works after undoing that one first', async () => {
        const w = await running(4)
        const sf1 = at(w, 1, 1)
        const sf2 = at(w, 1, 2)
        await record(w, sf1, win(sf1))
        await record(w, sf2, win(sf2))
        const final = at(w, 2, 1)
        await record(w, final, win(final))
        expect(placeOf(w, final.entryAId as string)).toBe(1)

        await expect(undo(w, sf1)).rejects.toMatchObject({ code: 'MATCH_UNDO_BLOCKED', statusCode: 409 })
        expect(at(w, 1, 1).winnerEntryId).toBe(sf1.entryAId)

        await expect(undo(w, final)).resolves.toEqual({
            divisionId: 'd1',
            round: 2,
            position: 1,
            previous: { winnerEntryId: final.entryAId, method: 'POINTS', scoreA: 4, scoreB: 2 },
        })
        // the final's places and finishedAt go
        expect(w.tables.tournamentEntry.every((e) => e.place === null)).toBe(true)
        expect(divisionRow(w).finishedAt).toBeNull()
        expect(at(w, 2, 1)).toMatchObject({ winnerEntryId: null, method: null, decidedAt: null, decidedById: null })

        await undo(w, at(w, 1, 1))
        expect(at(w, 1, 1)).toMatchObject({ winnerEntryId: null, scoreA: null })
        // the winner's slot downstream is cleared, the other side stays
        expect(at(w, 2, 1)).toMatchObject({ entryAId: null, entryBId: sf2.entryAId })
    })

    it('honours expectedUpdatedAt (STALE_UPDATE) and refuses after publication', async () => {
        const w = await running(2)
        const m = at(w, 1, 1)
        await record(w, m, win(m))
        await expect(undo(w, m, '2020-01-01T00:00:00.000Z')).rejects.toMatchObject({ code: 'STALE_UPDATE' })
        w.tables.tournament[0].status = 'FINISHED'
        await expect(undo(w, m)).rejects.toMatchObject({ code: 'TOURNAMENT_PUBLISHED', statusCode: 409 })
        expect(at(w, 1, 1).winnerEntryId).toBe(m.entryAId)
        w.tables.tournament[0].status = 'RUNNING'
        await undo(w, at(w, 1, 1), (at(w, 1, 1).updatedAt as Date).toISOString())
        expect(at(w, 1, 1).winnerEntryId).toBeNull()
    })

    it('refuses a bye, an undecided match, an unknown one and the wrong phase', async () => {
        const w = await running(3)
        const bye = matchesOf(w).find((m) => m.isBye)!
        await expect(undo(w, bye)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/без схватки/) })
        const [m] = readyOf(w)
        await expect(undo(w, m)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/не записан/) })
        await expect(undo(w, { ...m, id: 'nope' })).rejects.toMatchObject({ statusCode: 404 })
        w.tables.tournament[0].status = 'WEIGH_IN'
        await expect(undo(w, m)).rejects.toMatchObject({ statusCode: 400 })
    })
})

describe('moves', () => {
    const move = (w: World, entryId: string, toDivisionId: string) =>
        moveEntry(w.prisma as never, { tournamentId: T, entryId, toDivisionId })

    it('moves in WEIGH_IN, locking both divisions in id order', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        division(w, 'd0')
        entry(w, 'a')
        await expect(move(w, 'a', 'd0')).resolves.toEqual({ fromDivisionId: 'd1', cleared: true })
        expect(entryRow(w, 'a').divisionId).toBe('d0')
        expect(w.lockLog).toEqual([`tournament:${T}`, 'tournamentDivision:d0', 'tournamentDivision:d1'])
        await expect(move(w, 'a', 'd0')).resolves.toEqual({ fromDivisionId: 'd0', cleared: false })
    })

    it('two opposite moves at once never deadlock', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        division(w, 'd2')
        entry(w, 'a', { divisionId: 'd1' })
        entry(w, 'b', { divisionId: 'd2' })
        await Promise.all([move(w, 'a', 'd2'), move(w, 'b', 'd1')])
        expect([entryRow(w, 'a').divisionId, entryRow(w, 'b').divisionId]).toEqual(['d2', 'd1'])
    })

    it('in RUNNING clears both brackets while neither has results', async () => {
        const w = await running(3)
        division(w, 'd2', { drawnAt: NOW, drawNo: 1 })
        entry(w, 'z', { divisionId: 'd2', place: 1 })
        await expect(move(w, 'e1', 'd2')).resolves.toEqual({ fromDivisionId: 'd1', cleared: true })
        expect(matchesOf(w, 'd1')).toHaveLength(0)
        expect(divisionRow(w, 'd1')).toMatchObject({ drawnAt: null, finishedAt: null })
        expect(divisionRow(w, 'd2').drawnAt).toBeNull()
        expect(placeOf(w, 'z')).toBeNull()
    })

    it('refuses a move out of a division with results and changes nothing', async () => {
        const w = await running(4)
        division(w, 'd2')
        await record(w, at(w, 1, 1), win(at(w, 1, 1)))
        const loser = at(w, 1, 2).entryAId as string
        await expect(move(w, loser, 'd2')).rejects.toMatchObject({ code: 'DIVISION_HAS_RESULTS' })
        expect(entryRow(w, loser).divisionId).toBe('d1')
        expect(matchesOf(w)).toHaveLength(3)
    })

    it('moves a not yet drawable entry without touching a bracket', async () => {
        const w = await running(2)
        division(w, 'd2')
        entry(w, 'late', { divisionId: 'd2', weighedWeightG: null })
        await expect(move(w, 'late', 'd1')).resolves.toEqual({ fromDivisionId: 'd2', cleared: false })
        expect(matchesOf(w)).toHaveLength(1)
    })

    it('404s another tournament’s entry or division and refuses after publication', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        division(w, 'foreign', { tournamentId: 't2' })
        entry(w, 'a')
        entry(w, 'stranger', { tournamentId: 't2' })
        await expect(move(w, 'stranger', 'd1')).rejects.toMatchObject({ statusCode: 404 })
        await expect(move(w, 'a', 'foreign')).rejects.toMatchObject({ statusCode: 404 })
        w.tables.tournament[0].status = 'FINISHED'
        await expect(move(w, 'a', 'd1')).rejects.toMatchObject({ code: 'TOURNAMENT_PUBLISHED' })
    })
})

describe('withdrawal', () => {
    const withdraw = (w: World, entryId: string, withdrawn: boolean, reason: string | null = null) =>
        setEntryWithdrawn(w.prisma as never, { tournamentId: T, entryId, withdrawn, reason })

    it('releases a drawn division without results and returns the entrant to CONFIRMED', async () => {
        const w = await running(3)
        await withdraw(w, 'e1', true, 'Травма')
        expect(entryRow(w, 'e1')).toMatchObject({ status: 'WITHDRAWN', withdrawnReason: 'Травма', place: null })
        expect(matchesOf(w)).toHaveLength(0)
        expect(divisionRow(w).drawnAt).toBeNull()
        await withdraw(w, 'e1', true, 'Болезнь')
        expect(entryRow(w, 'e1').withdrawnReason).toBe('Болезнь')
        await withdraw(w, 'e1', false)
        expect(entryRow(w, 'e1')).toMatchObject({ status: 'CONFIRMED', withdrawnReason: null })
    })

    it('returns a never-confirmed entry to DECLARED', async () => {
        const w = world()
        tournament(w, 'SETUP')
        division(w, 'd1')
        entry(w, 'a', { status: 'WITHDRAWN', confirmedAt: null, weighedWeightG: null })
        await withdraw(w, 'a', false)
        expect(entryRow(w, 'a').status).toBe('DECLARED')
    })

    it('refuses once the division has results (the table records a walkover instead)', async () => {
        const w = await running(4)
        await record(w, at(w, 1, 1), win(at(w, 1, 1)))
        await expect(withdraw(w, at(w, 1, 2).entryAId as string, true)).rejects.toMatchObject({
            code: 'DIVISION_HAS_RESULTS',
        })
        expect(entryRow(w, at(w, 1, 2).entryAId as string).status).toBe('CONFIRMED')
    })

    it('404s another tournament’s entry and refuses after publication', async () => {
        const w = world()
        tournament(w, 'FINISHED')
        entry(w, 'a')
        await expect(withdraw(w, 'a', true)).rejects.toMatchObject({ code: 'TOURNAMENT_PUBLISHED' })
        w.tables.tournament[0].status = 'RUNNING'
        await expect(withdraw(w, 'nope', true)).rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('weigh-in', () => {
    const weigh = (w: World, entryId: string, g: number, assignDivisionId: string | null = null) =>
        recordWeighIn(w.prisma as never, {
            tournamentId: T,
            entryId,
            weighedWeightG: g,
            actorId: 'weigher',
            now: NOW,
            assignDivisionId,
        })

    it('confirms a DECLARED entry by the weigher and assigns the fitting division', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        entry(w, 'a', { status: 'DECLARED', weighedWeightG: null, divisionId: null, confirmedAt: null, confirmedById: null })
        await weigh(w, 'a', 77_400, 'd1')
        expect(entryRow(w, 'a')).toMatchObject({
            status: 'CONFIRMED',
            confirmedById: 'weigher',
            confirmedAt: NOW,
            weighedWeightG: 77_400,
            weighedAt: NOW,
            weighedById: 'weigher',
            divisionId: 'd1',
        })
    })

    it('a first weight releases a drawn division; re-weighing a weighed entrant does not', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        entry(w, 'a')
        entry(w, 'b')
        await drawDivision(w.prisma as never, { tournamentId: T, divisionId: 'd1', now: NOW })
        await weigh(w, 'a', 76_000)
        expect(matchesOf(w)).toHaveLength(1)
        expect(entryRow(w, 'a')).toMatchObject({ weighedWeightG: 76_000, confirmedById: 'coach' })
        entry(w, 'c', { weighedWeightG: null })
        await weigh(w, 'c', 75_000)
        expect(matchesOf(w)).toHaveLength(0)
        expect(divisionRow(w).drawnAt).toBeNull()
    })

    it('refuses outside WEIGH_IN, a withdrawn entrant and an unknown one', async () => {
        const w = world()
        tournament(w, 'SETUP')
        entry(w, 'a', { status: 'WITHDRAWN' })
        await expect(weigh(w, 'a', 70_000)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/не началось/) })
        w.tables.tournament[0].status = 'RUNNING'
        await expect(weigh(w, 'a', 70_000)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/закончено/) })
        w.tables.tournament[0].status = 'WEIGH_IN'
        await expect(weigh(w, 'a', 70_000)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/снят/) })
        await expect(weigh(w, 'nope', 70_000)).rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('club-side declarations', () => {
    const base = {
        tournamentId: T,
        registrationId: 'reg-1',
        userId: 'athlete',
        workspaceId: 'club-a',
        sex: 'MALE' as const,
        birthYear: 2001,
        declaredWeightG: 76_000,
        now: NOW,
    }
    const confirmation = {
        confirmedById: 'coach',
        templateLevelId: 'lvl-blue',
        levelName: 'Синий',
        levelSetById: null,
        divisionId: 'd1',
    }
    const declare = (w: World, o: Partial<Parameters<typeof declareEntry>[1]> = {}) =>
        declareEntry(w.prisma as never, { ...base, declaredById: 'athlete', confirmation: null, ...o })

    it('a self-declaration is DECLARED; a coach declaration is CONFIRMED with the division', async () => {
        const w = world()
        tournament(w, 'SETUP')
        await expect(declare(w)).resolves.toEqual({ entryId: expect.any(String), created: true })
        expect(w.tables.tournamentEntry[0]).toMatchObject({
            registrationId: 'reg-1',
            userId: 'athlete',
            workspaceId: 'club-a',
            status: 'DECLARED',
            declaredWeightG: 76_000,
            declaredById: 'athlete',
            divisionId: null,
        })
        const w2 = world()
        tournament(w2, 'SETUP')
        await declare(w2, { declaredById: 'coach', confirmation })
        expect(w2.tables.tournamentEntry[0]).toMatchObject({
            status: 'CONFIRMED',
            confirmedById: 'coach',
            confirmedAt: NOW,
            templateLevelId: 'lvl-blue',
            levelName: 'Синий',
            divisionId: 'd1',
        })
    })

    it('keeps a confirmation when nothing changed and resets it on a new weight', async () => {
        const w = world()
        tournament(w, 'SETUP')
        await declare(w, { declaredById: 'coach', confirmation })
        await expect(declare(w)).resolves.toMatchObject({ created: false })
        expect(w.tables.tournamentEntry[0]).toMatchObject({ status: 'CONFIRMED', divisionId: 'd1' })
        await declare(w, { declaredWeightG: 81_000 })
        expect(w.tables.tournamentEntry).toHaveLength(1)
        expect(w.tables.tournamentEntry[0]).toMatchObject({
            status: 'DECLARED',
            declaredWeightG: 81_000,
            confirmedById: null,
            confirmedAt: null,
            divisionId: null,
        })
    })

    it('is locked after SETUP (409 TOURNAMENT_LOCKED), under the tournament row lock', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        await expect(declare(w)).rejects.toMatchObject({ code: 'TOURNAMENT_LOCKED', statusCode: 409 })
        expect(w.lockLog).toEqual([`tournament:${T}`])
        expect(w.tables.tournamentEntry).toHaveLength(0)
    })

    it('a declaration racing «Начать взвешивание» either lands before it or is refused', async () => {
        const w = world()
        tournament(w, 'SETUP')
        const [phase, declared] = await Promise.allSettled([
            setTournamentStatus(w.prisma as never, { tournamentId: T, to: 'WEIGH_IN', now: NOW }),
            declare(w),
        ])
        expect(phase.status).toBe('fulfilled')
        // the phase change took the lock first, so the declaration is refused
        expect(declared).toMatchObject({ status: 'rejected', reason: { code: 'TOURNAMENT_LOCKED' } })
        expect(w.tables.tournamentEntry).toHaveLength(0)
    })

    it('the coach confirms in SETUP only; withdrawn and unknown entries are refused', async () => {
        const w = world()
        tournament(w, 'SETUP')
        entry(w, 'a', { status: 'DECLARED', divisionId: null, confirmedAt: null })
        entry(w, 'gone', { status: 'WITHDRAWN' })
        const confirm = (entryId: string) =>
            confirmEntry(w.prisma as never, { tournamentId: T, entryId, confirmation, now: NOW })
        await confirm('a')
        expect(entryRow(w, 'a')).toMatchObject({
            status: 'CONFIRMED',
            confirmedById: 'coach',
            levelName: 'Синий',
            levelSetById: null,
            divisionId: 'd1',
        })
        await expect(confirm('gone')).rejects.toMatchObject({ statusCode: 400 })
        await expect(confirm('nope')).rejects.toMatchObject({ statusCode: 404 })
        w.tables.tournament[0].status = 'WEIGH_IN'
        await expect(confirm('a')).rejects.toMatchObject({ code: 'TOURNAMENT_LOCKED' })
    })

    it('cancelling a registration deletes its SETUP entry and is locked afterwards', async () => {
        const w = world()
        const release = () =>
            releaseRegistrationEntry(w.prisma as never, { eventId: 'ev1', registrationId: 'reg-a' })
        await expect(release()).resolves.toBeUndefined()
        tournament(w, 'SETUP')
        entry(w, 'a')
        entry(w, 'b')
        await release()
        expect(w.tables.tournamentEntry.map((e) => e.id)).toEqual(['b'])
        w.tables.tournament[0].status = 'WEIGH_IN'
        await expect(
            releaseRegistrationEntry(w.prisma as never, { eventId: 'ev1', registrationId: 'reg-b' }),
        ).rejects.toMatchObject({ code: 'TOURNAMENT_LOCKED' })
        expect(w.tables.tournamentEntry).toHaveLength(1)
    })
})

describe('rollback', () => {
    it('a refused start leaves no withdrawal behind (the transaction rolls back)', async () => {
        const w = world()
        tournament(w, 'WEIGH_IN')
        division(w, 'd1')
        entry(w, 'a', { divisionId: null })
        entry(w, 'noshow', { weighedWeightG: null })
        await expect(
            setTournamentStatus(w.prisma as never, { tournamentId: T, to: 'RUNNING', now: NOW }),
        ).rejects.toMatchObject({ code: 'TOURNAMENT_UNASSIGNED' })
        expect(entryRow(w, 'noshow')).toMatchObject({ status: 'CONFIRMED', withdrawnReason: null })
    })
})
