import type { Actor } from '../support/actors'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { createDivisions, seedEntrant, setupTournament, type TournamentSetup } from './org-fixtures'

// Running a tournament (docs/design/2026-11-27-tournaments.md §2.1, §4.2,
// §4.4): weigh-in with a move, the start drawing brackets (byes, teammates
// apart), results advancing winners to places 1/2/3/3, two tablets on one
// match, undo at the frontier only.
type Competitor = { entryId: string; hidden: boolean; personName: string | null; clubName: string | null; place: number | null }
type Match = {
    id: string
    round: number
    position: number
    isBye: boolean
    entryA: Competitor | null
    entryB: Competitor | null
    winnerEntryId: string | null
    method: string | null
    decidedAt: string | null
    ready: boolean
    updatedAt: string
}
type Bracket = {
    division: { id: string; finishedAt: string | null; drawNo: number; state: string }
    size: number
    rounds: number
    matches: Match[]
}

describe('tournament run', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
    })

    const http = () => ctx.http()
    const base = (s: TournamentSetup) => `/orgs/${s.org.id}/tournaments/${s.tournament.id}`
    const setStatus = (s: TournamentSetup, status: string) =>
        http().post(`${base(s)}/status`).set(...s.secretary.auth).send({ status })
    const bracket = async (s: TournamentSetup, divisionId: string): Promise<Bracket> =>
        (await http().get(`${base(s)}/divisions/${divisionId}/bracket`).set(...s.secretary.auth).expect(200)).body
    const at = (b: Bracket, round: number, position: number) =>
        b.matches.find((m) => m.round === round && m.position === position)!
    const resultBody = (m: Match, side: 'A' | 'B', o: Record<string, unknown> = {}) => ({
        winnerEntryId: (side === 'A' ? m.entryA : m.entryB)!.entryId,
        method: 'POINTS',
        scoreA: 4,
        scoreB: 2,
        expectedUpdatedAt: m.updatedAt,
        ...o,
    })
    const record = (s: TournamentSetup, m: Match, body: Record<string, unknown>, actor: Actor = s.secretary) =>
        http().post(`${base(s)}/matches/${m.id}/result`).set(...actor.auth).send(body)
    const undo = (s: TournamentSetup, m: Match, expectedUpdatedAt?: string) =>
        http().post(`${base(s)}/matches/${m.id}/undo`).set(...s.secretary.auth).send({ expectedUpdatedAt })

    // A RUNNING tournament with `n` weighed entrants in one division (clubs
    // alternate ACADEMY / Беркут), drawn by the start.
    const runningWith = async (n: number) => {
        const s = await setupTournament(ctx)
        const [division] = await createDivisions(ctx, s, [{ sex: 'MALE', weightMaxKg: 76 }])
        const names = ['Иванов', 'Петров', 'Сидоров', 'Козлов', 'Морозов', 'Волков']
        for (let i = 0; i < n; i += 1) {
            await seedEntrant(ctx, s, {
                club: i % 2 === 0 ? s.academy.workspace : s.berkut.workspace,
                firstname: 'Спортсмен',
                lastname: names[i],
                divisionId: division.id,
                weighedKg: 75,
            })
        }
        await setStatus(s, 'WEIGH_IN').expect(201)
        await setStatus(s, 'RUNNING').expect(201)
        return { s, division }
    }

    it('weigh-in moves an off-weight athlete and start draws five entrants with three byes and teammates apart', async () => {
        const s = await setupTournament(ctx)
        const [light, heavy] = await createDivisions(ctx, s, [
            { sex: 'MALE', weightMaxKg: 76 },
            { sex: 'MALE', weightMinKg: 76, weightMaxKg: 82 },
        ])
        const enter = (club: { id: string }, lastname: string) =>
            seedEntrant(ctx, s, { club, firstname: 'Спортсмен', lastname, divisionId: light.id })
        const a1 = await enter(s.academy.workspace, 'Иванов')
        const a2 = await enter(s.academy.workspace, 'Петров')
        const b1 = await enter(s.berkut.workspace, 'Сидоров')
        const b2 = await enter(s.berkut.workspace, 'Козлов')
        const b3 = await enter(s.berkut.workspace, 'Морозов')
        const off = await enter(s.berkut.workspace, 'Тяжёлый')
        const noshow = await enter(s.academy.workspace, 'Неявкин')
        const clubOf = new Map(
            [a1, a2, b1, b2, b3, off].map((e) => [e.entry.id, e.entry.workspaceId] as const),
        )

        // Weighing is the WEIGH_IN phase only.
        const weigh = (entryId: string, weighedKg: number) =>
            http().put(`${base(s)}/entries/${entryId}/weigh-in`).set(...s.secretary.auth).send({ weighedKg })
        await weigh(a1.entry.id, 75).expect(400)
        await setStatus(s, 'WEIGH_IN').expect(201)
        for (const e of [a1, a2, b1, b2, b3]) {
            expect((await weigh(e.entry.id, 75.2).expect(200)).body).toMatchObject({ fits: true, entry: { weighedWeightKg: 75.2 } })
        }
        // 77,4 for «до 76 кг»: the neighbouring division is offered, one move.
        const offWeight = (await weigh(off.entry.id, 77.4).expect(200)).body
        expect(offWeight).toMatchObject({
            fits: false,
            suggestedDivisionId: heavy.id,
            suggestedDivisionName: heavy.name,
            entry: { weighedWeightKg: 77.4, divisionId: light.id },
        })
        await http()
            .post(`${base(s)}/entries/${off.entry.id}/move`)
            .set(...s.secretary.auth)
            .send({ divisionId: heavy.id })
            .expect(201)
        const before = (await http().get(base(s)).set(...s.secretary.auth).expect(200)).body
        expect(before.counts).toMatchObject({ weighed: 6, unweighed: 1, unassigned: 0 })

        // The start: the unweighed are withdrawn, every division is drawn.
        const started = (await setStatus(s, 'RUNNING').expect(201)).body
        expect(started).toMatchObject({ status: 'RUNNING', counts: { divisionsDrawn: 2, withdrawn: 1 } })
        const withdrawn = (
            await http().get(`${base(s)}/entries?filter=withdrawn`).set(...s.secretary.auth).expect(200)
        ).body.data
        expect(withdrawn).toEqual([
            expect.objectContaining({ id: noshow.entry.id, status: 'WITHDRAWN', withdrawnReason: 'Не взвешен' }),
        ])

        const b = await bracket(s, light.id)
        expect(b).toMatchObject({ size: 8, rounds: 3 })
        const first = b.matches.filter((m) => m.round === 1)
        expect(first).toHaveLength(4)
        const byes = first.filter((m) => m.isBye)
        expect(byes).toHaveLength(3)
        for (const m of byes) {
            // never two byes in one pair; the athlete is through at once
            expect([m.entryA, m.entryB].filter(Boolean)).toHaveLength(1)
            expect(m.winnerEntryId).toBe((m.entryA ?? m.entryB)!.entryId)
        }
        const [fight] = first.filter((m) => !m.isBye)
        expect(fight.ready).toBe(true)
        expect(clubOf.get(fight.entryA!.entryId)).not.toBe(clubOf.get(fight.entryB!.entryId))
        // The two ACADEMY teammates sit in opposite halves: they can meet only in the final.
        const half = (entryId: string) =>
            first.find((m) => m.entryA?.entryId === entryId || m.entryB?.entryId === entryId)!.position <= 2
        expect(half(a1.entry.id)).not.toBe(half(a2.entry.id))

        // Alone in «до 82 кг»: 1st place «без соперника» at the draw.
        const alone = await bracket(s, heavy.id)
        expect(alone.matches).toEqual([])
        expect(alone.division.finishedAt).not.toBeNull()
        expect(
            await ctx.prisma.tournamentEntry.findUniqueOrThrow({ where: { id: off.entry.id }, select: { place: true } }),
        ).toEqual({ place: 1 })
    })

    it('results advance winners and the final yields places 1, 2, 3, 3', async () => {
        const { s, division } = await runningWith(4)
        await http().post(`${base(s)}/mats/assign`).set(...s.secretary.auth).expect(201)
        const queue = (await http().get(`${base(s)}/mats/1/queue`).set(...s.secretary.auth).expect(200)).body
        let b = await bracket(s, division.id)
        expect(queue).toMatchObject({ mat: 1, current: { id: at(b, 1, 1).id }, next: [{ id: at(b, 1, 2).id }] })

        const sf1 = at(b, 1, 1)
        const sf2 = at(b, 1, 2)
        b = (await record(s, sf1, resultBody(sf1, 'A')).expect(201)).body
        expect(at(b, 2, 1).entryA?.entryId).toBe(sf1.entryA!.entryId)
        expect(at(b, 2, 1).ready).toBe(false)
        b = (await record(s, sf2, resultBody(sf2, 'B', { method: 'FINISH', scoreA: null, scoreB: null, note: 'Удушающий' })).expect(201)).body
        const final = at(b, 2, 1)
        expect(final).toMatchObject({ ready: true, entryB: { entryId: sf2.entryB!.entryId } })
        expect(
            (await http().get(`${base(s)}/mats/1/queue`).set(...s.secretary.auth).expect(200)).body.current.id,
        ).toBe(final.id)

        b = (await record(s, final, resultBody(final, 'B')).expect(201)).body
        expect(b.division.finishedAt).not.toBeNull()
        const results = (await http().get(`${base(s)}/results`).set(...s.secretary.auth).expect(200)).body
        expect(results.divisions).toEqual([
            expect.objectContaining({
                divisionId: division.id,
                finished: true,
                podium: [
                    expect.objectContaining({ place: 1, entryId: sf2.entryB!.entryId }),
                    expect.objectContaining({ place: 2, entryId: sf1.entryA!.entryId }),
                    expect.objectContaining({ place: 3 }),
                    expect.objectContaining({ place: 3 }),
                ],
            }),
        ])
        const thirds = results.divisions[0].podium.filter((r: { place: number }) => r.place === 3)
        expect(thirds.map((r: { entryId: string }) => r.entryId).sort()).toEqual(
            [sf1.entryB!.entryId, sf2.entryA!.entryId].sort(),
        )
        expect((await http().get(base(s)).set(...s.secretary.auth).expect(200)).body.counts.divisionsFinished).toBe(1)
        // The journal has the results, without names.
        const journal = await ctx.prisma.auditEvent.findMany({
            where: { organizationId: s.org.id, action: 'tournament.matchResult' },
        })
        expect(journal).toHaveLength(3)
        expect(JSON.stringify(journal.map((j) => j.metadata))).not.toMatch(/Иванов|Петров|Сидоров|Козлов/)
    })

    it('two tablets record one match: the second gets STALE_UPDATE, an identical retry succeeds', async () => {
        const { s, division } = await runningWith(2)
        const final = at(await bracket(s, division.id), 1, 1)
        const forA = resultBody(final, 'A')
        const forB = resultBody(final, 'B')

        const [one, two] = await Promise.all([record(s, final, forA), record(s, final, forB)])
        expect([one.status, two.status].sort()).toEqual([201, 409])
        const won = one.status === 201 ? forA : forB
        const lost = one.status === 201 ? two : one
        expect(lost.body).toMatchObject({
            code: 'STALE_UPDATE',
            message: 'Результат уже записан с другого планшета',
            metadata: { winnerEntryId: won.winnerEntryId, method: 'POINTS', scoreA: 4, scoreB: 2 },
        })
        const stored = at(await bracket(s, division.id), 1, 1)
        expect(stored.winnerEntryId).toBe(won.winnerEntryId)

        // The winning tablet's Wi-Fi blip: the same request again, even with the
        // stale timestamp, answers 200 with the current state and writes nothing.
        const retry = (await record(s, final, won).expect(201)).body as Bracket
        expect(at(retry, 1, 1)).toMatchObject({ winnerEntryId: won.winnerEntryId, decidedAt: stored.decidedAt })
        expect(
            await ctx.prisma.auditEvent.count({ where: { organizationId: s.org.id, action: 'tournament.matchResult' } }),
        ).toBe(1)
        // A different result later is still refused: changing a result goes through undo.
        const changed = await record(s, final, { ...won, scoreA: 9, expectedUpdatedAt: stored.updatedAt }).expect(409)
        expect(changed.body.code).toBe('STALE_UPDATE')
    })

    it('undo is blocked while the next match is decided and works after undoing that one first', async () => {
        const { s, division } = await runningWith(4)
        let b = await bracket(s, division.id)
        await record(s, at(b, 1, 1), resultBody(at(b, 1, 1), 'A')).expect(201)
        b = (await record(s, at(b, 1, 2), resultBody(at(b, 1, 2), 'A')).expect(201)).body
        b = (await record(s, at(b, 2, 1), resultBody(at(b, 2, 1), 'A')).expect(201)).body
        expect(b.division.finishedAt).not.toBeNull()

        const blocked = await undo(s, at(b, 1, 1)).expect(409)
        expect(blocked.body).toMatchObject({
            code: 'MATCH_UNDO_BLOCKED',
            message: expect.stringContaining('Сначала отмените'),
        })
        // A stale undo is refused like a stale result.
        const final = at(b, 2, 1)
        await undo(s, final, '2020-01-01T00:00:00.000Z').expect(409)

        b = (await undo(s, final, final.updatedAt).expect(201)).body
        expect(at(b, 2, 1)).toMatchObject({ winnerEntryId: null, method: null })
        expect(b.division.finishedAt).toBeNull()
        expect(await ctx.prisma.tournamentEntry.count({ where: { divisionId: division.id, place: { not: null } } })).toBe(0)

        const sf1 = at(b, 1, 1)
        b = (await undo(s, sf1).expect(201)).body
        expect(at(b, 1, 1).winnerEntryId).toBeNull()
        // The winner's slot downstream is empty again; the other semifinal's winner stays.
        expect(at(b, 2, 1).entryA).toBeNull()
        expect(at(b, 2, 1).entryB?.entryId).toBe(at(b, 1, 2).winnerEntryId)
        const journal = await ctx.prisma.auditEvent.findMany({
            where: { organizationId: s.org.id, action: 'tournament.matchUndo' },
            orderBy: { createdAt: 'asc' },
        })
        expect(journal.map((j) => (j.metadata as { previous?: { method?: string } }).previous?.method)).toEqual([
            'POINTS',
            'POINTS',
        ])
    })
})
