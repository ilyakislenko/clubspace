import { bracketSize, firstRoundMatches, placingsFor, roundCount, seedBracket } from '../tournaments/bracket'
import { nextMatchFor } from '../tournaments/schedule'
import {
    buildDemoOrganizationRows,
    DEMO_ORG_ID,
    type DemoOrgClub,
    type DemoOrgPerson,
    type DemoOrgRows,
} from './demo-organization'
import {
    DEMO_CUP_MATS,
    DEMO_OPEN_CONFIRMED,
    DEMO_OPEN_DECLARED,
    DEMO_STUDENT_CUP_DIVISION,
    DEMO_STUDENT_MAT,
    demoDivisionId,
    demoEntryId,
    demoTournamentEventId,
    demoTournamentId,
    sexFromName,
} from './demo-tournaments'

const NOW = new Date('2026-11-27T07:15:00.000Z') // 14:15 in Tomsk
const DAY = 86_400_000
const ACADEMY: DemoOrgClub = { id: 'w-academy', name: 'ACADEMY', ownerId: 'u-owner-a', ownerEmail: 'owner@academy.demo', coachId: 'u-coach-a' }
const BERKUT: DemoOrgClub = { id: 'w-berkut', name: 'Беркут', ownerId: 'u-owner-b', ownerEmail: 'owner@berkut.demo', coachId: 'u-coach-b' }

// Two clubs like the demo ones: men of every belt, some women, children with
// a confirmed guardian, plus student@ (a white belt, 29) and Миша (11).
const population = (club: DemoOrgClub, adults: number, kids: number): DemoOrgPerson[] => [
    ...Array.from({ length: adults }, (_, i): DemoOrgPerson => ({
        userId: `${club.id}-a${i}`,
        workspaceId: club.id,
        guardianId: null,
        isChild: false,
        competes: true,
        tournament: {
            sex: i % 7 === 0 ? 'FEMALE' : 'MALE',
            birthYear: 1980 + (i % 25),
            level: { template: 'adults', order: i % 3 === 0 ? 1 + (i % 4) : 0 },
        },
    })),
    ...Array.from({ length: kids }, (_, i): DemoOrgPerson => ({
        userId: `${club.id}-k${i}`,
        workspaceId: club.id,
        guardianId: `${club.id}-p${i}`,
        isChild: true,
        competes: true,
        tournament: { sex: i % 3 === 0 ? 'FEMALE' : 'MALE', birthYear: 2014 + (i % 6), level: { template: 'kids', order: i % 3 } },
    })),
]
const SCRIPT: DemoOrgPerson[] = [
    { userId: 'student', workspaceId: 'w-academy', guardianId: null, isChild: false, competes: true, consent: true, tournament: { sex: 'MALE', birthYear: 1997, level: { template: 'adults', order: 0 }, role: 'student' } },
    { userId: 'misha', workspaceId: 'w-academy', guardianId: 'parent', isChild: true, competes: true, consent: true, tournament: { sex: 'MALE', birthYear: 2015, level: { template: 'kids', order: 1 }, role: 'misha' } },
    { userId: 'anya', workspaceId: 'w-academy', guardianId: 'parent', isChild: true, competes: true, consent: false, tournament: { sex: 'FEMALE', birthYear: 2019, level: null } },
]
const PEOPLE = [...SCRIPT, ...population(ACADEMY, 160, 30), ...population(BERKUT, 60, 20)]
const build = (now: Date = NOW, people: readonly DemoOrgPerson[] = PEOPLE) =>
    buildDemoOrganizationRows({ now, federationUserId: 'u-fed', secretaryUserId: 'u-sec', clubs: { academy: ACADEMY, berkut: BERKUT }, people })

// Checks every promise the demo script makes about its tournaments.
const checkDemoTournaments = (rows: DemoOrgRows, now: Date): void => {
    const byKey = (key: 'autumn' | 'cup' | 'open') => rows.tournaments.find((t) => t.id === demoTournamentId(key))!
    expect(byKey('autumn')).toMatchObject({ status: 'FINISHED', matCount: 2 })
    expect(byKey('cup')).toMatchObject({ status: 'RUNNING', matCount: DEMO_CUP_MATS, resultsPublishedAt: null })
    expect(byKey('open')).toMatchObject({ status: 'SETUP' })
    expect((byKey('autumn').resultsPublishedAt as Date).getTime()).toBeLessThan(now.getTime())

    // Nothing «in the future».
    for (const m of rows.matches) if (m.decidedAt) expect((m.decidedAt as Date).getTime()).toBeLessThanOrEqual(now.getTime())
    for (const e of rows.entries) {
        expect((e.createdAt as Date).getTime()).toBeLessThanOrEqual(now.getTime())
        if (e.confirmedAt) expect((e.confirmedAt as Date).getTime()).toBeLessThanOrEqual(now.getTime())
    }
    for (const r of rows.registrations) expect((r.createdAt as Date).getTime()).toBeLessThanOrEqual(now.getTime())
    for (const a of rows.auditEvents) expect((a.createdAt as Date).getTime()).toBeLessThanOrEqual(now.getTime())

    // Every drawn bracket is the real seeding and every finished division
    // has the real placings.
    for (const d of rows.divisions.filter((x) => x.drawnAt)) {
        const entries = rows.entries.filter((e) => e.divisionId === d.id && e.status === 'CONFIRMED')
        const matches = rows.matches.filter((m) => m.divisionId === d.id)
        if (entries.length > 1) {
            const slots = seedBracket(entries.map((e) => ({ id: e.id as string, clubId: e.workspaceId })), `${d.id}:${d.drawNo}`)
            const first = matches.filter((m) => m.round === 1).sort((a, b) => a.position - b.position)
            expect(first.map((m) => [m.entryAId, m.entryBId, m.isBye])).toEqual(firstRoundMatches(slots).map((f) => [f.entryAId, f.entryBId, f.isBye]))
            expect(matches).toHaveLength(bracketSize(entries.length) - 1)
        }
        if (d.finishedAt) {
            const places = placingsFor(matches.map((m) => ({ ...m, entryAId: m.entryAId ?? null, entryBId: m.entryBId ?? null, isBye: !!m.isBye, winnerEntryId: m.winnerEntryId ?? null, method: m.method ?? null })), entries.map((e) => e.id as string))
            for (const e of entries) expect(e.place ?? null).toBe(places.get(e.id as string) ?? null)
        } else {
            for (const e of entries) expect(e.place ?? null).toBeNull()
        }
    }

    // The 1st stage: all decided, weights cleared; student@ 3rd, Миша 2nd.
    const autumn = rows.entries.filter((e) => e.tournamentId === demoTournamentId('autumn'))
    expect(autumn.length).toBeGreaterThanOrEqual(30)
    expect(autumn.every((e) => e.declaredWeightG === null && e.weighedWeightG === null)).toBe(true)
    expect(rows.matches.filter((m) => m.tournamentId === demoTournamentId('autumn')).every((m) => m.winnerEntryId)).toBe(true)
    expect(autumn.find((e) => e.id === demoEntryId('autumn', 'student'))?.place).toBe(3)
    expect(autumn.find((e) => e.id === demoEntryId('autumn', 'misha'))?.place).toBe(2)

    // The running cup: on every mat something done and something waiting;
    // student@ is next but one on mat 2 in a division that has begun.
    const cupDivisions = rows.divisions.filter((d) => d.tournamentId === demoTournamentId('cup'))
    const cupMatches = rows.matches.filter((m) => m.tournamentId === demoTournamentId('cup'))
    const schedule = cupDivisions.map((d) => ({ id: d.id as string, sortOrder: d.sortOrder, mat: d.mat ?? null, matOrder: d.matOrder ?? null }))
    const plain = cupMatches.map((m) => ({ id: m.id as string, divisionId: m.divisionId, round: m.round, position: m.position, entryAId: m.entryAId ?? null, entryBId: m.entryBId ?? null, isBye: !!m.isBye, winnerEntryId: m.winnerEntryId ?? null }))
    const next = nextMatchFor(demoEntryId('cup', 'student'), schedule, plain)
    expect(next).toMatchObject({ mat: DEMO_STUDENT_MAT, ahead: 1 })
    expect(next!.opponentEntryId).not.toBeNull()
    const studentDivision = demoDivisionId('cup', DEMO_STUDENT_CUP_DIVISION)
    expect(rows.entries.find((e) => e.id === demoEntryId('cup', 'student'))?.divisionId).toBe(studentDivision)
    expect(cupMatches.some((m) => m.divisionId === studentDivision && !m.isBye && m.winnerEntryId)).toBe(true)
    expect(cupDivisions.some((d) => d.finishedAt && d.mat)).toBe(true)
    expect(cupDivisions.filter((d) => d.drawnAt && !d.finishedAt).length).toBeGreaterThanOrEqual(3)
    expect(cupMatches.some((m) => !m.isBye && m.entryAId && m.entryBId && !m.winnerEntryId)).toBe(true)
    const cupEntries = rows.entries.filter((e) => e.tournamentId === demoTournamentId('cup'))
    expect(cupEntries.filter((e) => e.status === 'WITHDRAWN').map((e) => e.withdrawnReason)).toEqual(['Не взвешен'])
    expect(cupEntries.filter((e) => e.status === 'CONFIRMED').every((e) => e.weighedWeightG && e.declaredWeightG)).toBe(true)
    const move = rows.auditEvents.filter((a) => a.action === 'tournament.entryMove')
    expect(move).toHaveLength(1)
    // The seed writes this shape itself (demo-tournaments.ts).
    const moveMeta = move[0].metadata as { entryId: string; toDivisionId: string }
    expect(cupEntries.find((e) => e.id === moveMeta.entryId)?.divisionId).toBe(moveMeta.toDivisionId)

    // The open tournament: 3 waiting for ACADEMY's coach, 12 confirmed, the
    // rest of its registrations without a weight.
    const open = rows.entries.filter((e) => e.tournamentId === demoTournamentId('open'))
    const declared = open.filter((e) => e.status === 'DECLARED')
    expect(declared).toHaveLength(DEMO_OPEN_DECLARED)
    expect(declared.every((e) => e.workspaceId === ACADEMY.id && e.divisionId === null && e.declaredById === e.userId)).toBe(true)
    const confirmed = open.filter((e) => e.status === 'CONFIRMED')
    expect(confirmed).toHaveLength(DEMO_OPEN_CONFIRMED)
    expect(confirmed.every((e) => e.divisionId && e.confirmedById)).toBe(true)
    const openRegistrations = rows.registrations.filter((r) => r.eventId === rows.tournaments.find((t) => t.id === demoTournamentId('open'))!.eventId)
    expect(openRegistrations.length).toBeGreaterThan(open.length)
    expect(open.every((e) => openRegistrations.some((r) => r.id === e.registrationId && r.userId === e.userId))).toBe(true)
}

describe('buildDemoTournamentRows (through buildDemoOrganizationRows)', () => {
    const rows = build()

    it('is deterministic for a fixed now', () => {
        expect(JSON.stringify(build())).toBe(JSON.stringify(rows))
    })

    it('keeps every promise of the script', () => {
        checkDemoTournaments(rows, NOW)
    })

    it('holds on every reset day and hour for two weeks', () => {
        for (let d = 0; d < 14; d++) {
            for (const h of [0, 3, 9, 15, 21]) {
                const now = new Date(NOW.getTime() + d * DAY + h * 3_600_000)
                checkDemoTournaments(build(now), now)
            }
        }
    })

    it('uses the ids the admin smoke pins', () => {
        expect(DEMO_ORG_ID).toBe('ef792a0a-158f-4afd-9f49-a336b38d0d87')
        expect(demoTournamentEventId('cup')).toBe('5f68658e-0226-4a50-b495-d9f6c6d57de5')
        expect(demoTournamentEventId('autumn')).toBe('ab6f7d09-1b62-43cb-83e2-6af13eb8f555')
        expect(demoDivisionId('cup', DEMO_STUDENT_CUP_DIVISION)).toBe('0e194e7d-6b00-4fbd-96d0-234b881e6edf')
        expect(rows.events.map((e) => e.id)).toEqual(expect.arrayContaining([demoTournamentEventId('cup'), demoTournamentEventId('autumn')]))
    })

    it('anchors the cup to now − 2 h on 3 mats, the 1st stage 40 days ago', () => {
        const cup = rows.events.find((e) => e.id === demoTournamentEventId('cup'))!
        const start = (cup.startAt as Date).getTime()
        expect(start % (10 * 60_000)).toBe(0)
        expect(NOW.getTime() - start).toBeGreaterThanOrEqual(120 * 60_000)
        expect(NOW.getTime() - start).toBeLessThan(130 * 60_000)
        expect((cup.endAt as Date).getTime() - start).toBe(8 * 3_600_000)
        const mats = new Set(rows.divisions.filter((d) => d.tournamentId === demoTournamentId('cup') && d.drawnAt).map((d) => d.mat))
        expect([...mats].sort()).toEqual([1, 2, 3])
        const autumn = rows.events.find((e) => e.id === demoTournamentEventId('autumn'))!
        expect(Math.round((NOW.getTime() - (autumn.startAt as Date).getTime()) / DAY)).toBe(40)
    })

    it('never enters anyone without consent, nor the script\'s undecided people', () => {
        expect(rows.entries.some((e) => e.userId === 'anya')).toBe(false)
        const consented = new Set(rows.consents.map((c) => c.dependentId ?? c.userId))
        expect(rows.entries.every((e) => consented.has(e.userId))).toBe(true)
        // The hub's open tournament still leaves the script's people to
        // register live.
        expect(rows.entries.some((e) => e.tournamentId === demoTournamentId('open') && ['student', 'misha'].includes(e.userId))).toBe(false)
    })

    it('marks the past pushes as sent so a reset never sends them', () => {
        const kinds = new Set(rows.dispatchClaims.map((c) => c.kind))
        expect([...kinds].sort()).toEqual(['tournament.bracket_ready', 'tournament.results_published'])
        expect(rows.dispatchClaims).toContainEqual({ kind: 'tournament.bracket_ready', refId: `${demoEntryId('cup', 'student')}:1` })
    })

    it('records the org-side journal with the secretary at the table, no names or weights', () => {
        const results = rows.auditEvents.filter((a) => a.action === 'tournament.matchResult')
        expect(results.length).toBe(rows.matches.filter((m) => !m.isBye && m.winnerEntryId).length)
        expect(results.every((a) => a.actorId === 'u-sec' && a.workspaceId === null && a.organizationId === DEMO_ORG_ID)).toBe(true)
        expect(rows.auditEvents.filter((a) => a.action === 'tournament.publish').map((a) => a.actorId)).toEqual(['u-fed'])
        expect(JSON.stringify(rows.auditEvents.filter((a) => a.action.startsWith('tournament.')).map((a) => a.metadata))).not.toMatch(/Weight|weight|name"/)
    })

    it('decides matches like a table: scores only on points/decision, a hold only on a finish', () => {
        for (const m of rows.matches.filter((x) => !x.isBye && x.winnerEntryId)) {
            if (m.method === 'POINTS') expect((m.scoreA ?? -1) !== (m.scoreB ?? -1)).toBe(true)
            if (m.method === 'DECISION') expect(m.scoreA).toBe(m.scoreB)
            if (m.method === 'FINISH') expect(m.note).toBeTruthy()
            else expect(m.note ?? null).toBeNull()
            const rounds = roundCount(bracketSize(rows.entries.filter((e) => e.divisionId === m.divisionId && e.status === 'CONFIRMED').length))
            if (m.method === 'WALKOVER' || m.method === 'DISQUALIFICATION') expect(m.round).toBeLessThan(rounds - 1)
        }
    })
})

describe('sexFromName', () => {
    it.each([
        ['Максим', 'Иванов', 'MALE'],
        ['Ирина', 'Ковалёва', 'FEMALE'],
        ['Миша', 'Соколов', 'MALE'],
        ['Аня', 'Соколова', 'FEMALE'],
        ['Ольга', 'Белая', 'FEMALE'],
        ['Никита', 'Ким', 'MALE'],
        ['Юлия', 'Ким', 'FEMALE'],
    ] as const)('%s %s → %s', (first, last, sex) => {
        expect(sexFromName(first, last)).toBe(sex)
    })
})
