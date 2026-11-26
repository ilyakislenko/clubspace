import { createHash } from 'crypto'

import { localDateInTz, wallClockToUtc } from '../../features/attendance/attendance-utils'
import type { Prisma } from '../../infrastructure/prisma'
import { addDaysYmd } from '../subscriptions/freeze-dates'
import {
    bracketSize,
    firstRoundMatches,
    type MethodName,
    nextSlot,
    placingsFor,
    roundCount,
    seedBracket,
} from '../tournaments/bracket'
import {
    ageFor,
    type CompetitorSex,
    type DivisionCriteria,
    divisionName,
    kgToGrams,
    levelRangeLabel,
    matchDivision,
} from '../tournaments/divisions'
import { matQueue, nextMatchFor } from '../tournaments/schedule'
import { demoUuid } from './demo-club.plan'
import type { DemoOrgClub, DemoOrgTemplateKey } from './demo-organization'

// The demo federation's tournaments (docs/demo.md «Турниры», design
// docs/design/2026-11-27-tournaments.md §10), on top of the hub seed
// (demo-organization.ts):
// - «Кубок федерации, 1-й этап» (`autumn`) was 40 days ago at «Беркут»: every
//   match decided, results published at 19:00, the weights already cleared by
//   the 30-day retention. student@ took 3rd, Миша 2nd.
// - «Кубок федерации, 2-й этап» (`cup`) is running now at ACADEMY on 3 mats,
//   anchored to now − 2 h: on each mat the first division is finished, the
//   next one mid-way, the rest drawn and waiting. student@ is in a mid-way
//   division with his next match ready on mat 2 behind one match. One entry
//   was moved at the weigh-in, one withdrawn «Не взвешен».
// - «Открытый турнир Томской области» (`open`, the hub's event in 24 days)
//   takes entries: about 12 confirmed with a division, 3 declared and waiting
//   for ACADEMY's coaches, the rest of its registrations without a weight.
// Brackets come from the real seedBracket / placingsFor and queues from
// matQueue / nextMatchFor, so the demo shows exactly what the console would
// have produced. Pure and deterministic for a given `now` and population.

export type DemoTournamentKey = 'autumn' | 'cup' | 'open'

export const demoTournamentEventId = (key: 'autumn' | 'cup') => demoUuid(`org:tomsk:event:${key}`)
export const demoTournamentId = (key: DemoTournamentKey) => demoUuid(`org:tomsk:tournament:${key}`)
export const demoDivisionId = (key: DemoTournamentKey, slug: string) =>
    demoUuid(`org:tomsk:tournament:${key}:division:${slug}`)
export const demoEntryId = (key: DemoTournamentKey, userId: string) =>
    demoUuid(`org:tomsk:tournament:${key}:entry:${userId}`)

export const DEMO_TOURNAMENT_TITLES = {
    autumn: 'Кубок федерации, 1-й этап',
    cup: 'Кубок федерации, 2-й этап',
} as const
export const DEMO_AUTUMN_DAYS_AGO = 40
export const DEMO_CUP_MATS = 3
const AUTUMN_MATS = 2
const OPEN_MATS = 2
// The table records a match every 7 minutes on each mat.
export const DEMO_MATCH_MINUTES = 7
// student@'s division at the running cup (admin smoke pins its id).
export const DEMO_STUDENT_CUP_DIVISION = 'men-white-82'
export const DEMO_STUDENT_MAT = 2
// Entries per division at most (the rest of the eligible stay home).
const CAP = { autumn: 7, cup: 6 } as const
// The open tournament: declared and waiting for the coach / confirmed.
export const DEMO_OPEN_DECLARED = 3
export const DEMO_OPEN_CONFIRMED = 12

type DivisionDef = {
    slug: string
    sex: CompetitorSex | null
    ageMin: number | null
    ageMax: number | null
    template: DemoOrgTemplateKey | null
    levelFrom: number | null
    levelTo: number | null
    minKg: number | null
    maxKg: number | null
}

// One set for all three tournaments (the cup and the open one copied the 1st
// stage's): adult men by belt × weight, women in open weight, children by age
// in open weight (few children compete in a city federation's cup).
export const DEMO_DIVISIONS: readonly DivisionDef[] = [
    { slug: 'men-white-70', sex: 'MALE', ageMin: 18, ageMax: null, template: 'adults', levelFrom: 0, levelTo: 0, minKg: null, maxKg: 70 },
    { slug: 'men-white-82', sex: 'MALE', ageMin: 18, ageMax: null, template: 'adults', levelFrom: 0, levelTo: 0, minKg: 70, maxKg: 82 },
    { slug: 'men-white-plus82', sex: 'MALE', ageMin: 18, ageMax: null, template: 'adults', levelFrom: 0, levelTo: 0, minKg: 82, maxKg: null },
    { slug: 'men-blue-76', sex: 'MALE', ageMin: 18, ageMax: null, template: 'adults', levelFrom: 1, levelTo: 4, minKg: null, maxKg: 76 },
    { slug: 'men-blue-88', sex: 'MALE', ageMin: 18, ageMax: null, template: 'adults', levelFrom: 1, levelTo: 4, minKg: 76, maxKg: 88 },
    { slug: 'men-blue-plus88', sex: 'MALE', ageMin: 18, ageMax: null, template: 'adults', levelFrom: 1, levelTo: 4, minKg: 88, maxKg: null },
    { slug: 'women-open', sex: 'FEMALE', ageMin: 18, ageMax: null, template: null, levelFrom: null, levelTo: null, minKg: null, maxKg: null },
    { slug: 'kids-7-9', sex: null, ageMin: 7, ageMax: 9, template: null, levelFrom: null, levelTo: null, minKg: null, maxKg: null },
    { slug: 'kids-10-13', sex: null, ageMin: 10, ageMax: 13, template: null, levelFrom: null, levelTo: null, minKg: null, maxKg: null },
]

export type DemoTournamentPerson = {
    userId: string
    workspaceId: string
    // A child's entry is declared by the guardian (consent through them).
    guardianId: string | null
    isChild: boolean
    sex: CompetitorSex
    birthYear: number
    // The registry belt: the level on a federation standard.
    level: { template: DemoOrgTemplateKey; order: number } | null
    // The people of the demo script.
    role?: 'student' | 'misha'
}

export type DemoTournamentTemplate = {
    key: DemoOrgTemplateKey
    id: string
    levels: readonly { id: string; order: number; name: string }[]
}

export type DemoOpenRegistration = {
    id: string
    userId: string
    workspaceId: string
    bookedById: string | null
    createdAt: Date
}

export type DemoTournamentInput = {
    now: Date
    timezone: string
    organizationId: string
    federation: { id: string; email: string }
    secretary: { id: string; email: string }
    clubs: { academy: DemoOrgClub | null; berkut: DemoOrgClub | null }
    // Consenting people of the linked clubs (own or a guardian's consent).
    people: readonly DemoTournamentPerson[]
    templates: readonly DemoTournamentTemplate[]
    // The hub's «Открытый турнир Томской области» and its registrations.
    open: { eventId: string; startAt: Date; createdAt: Date; registrations: readonly DemoOpenRegistration[] } | null
}

export type DemoTournamentRows = {
    events: Prisma.OrganizationEventCreateManyInput[]
    registrations: Prisma.OrganizationEventRegistrationCreateManyInput[]
    tournaments: Prisma.TournamentCreateManyInput[]
    divisions: Prisma.TournamentDivisionCreateManyInput[]
    entries: Prisma.TournamentEntryCreateManyInput[]
    matches: Prisma.TournamentMatchCreateManyInput[]
    auditEvents: Prisma.AuditEventCreateManyInput[]
    // Pushes the reset must never send (already «delivered»).
    dispatchClaims: { kind: string; refId: string }[]
}

// A stable draw in [0, 1) per thing, independent of the club generators.
const draw = (salt: string, id: string) =>
    parseInt(createHash('sha256').update(`clubspace-demo:tournament:${salt}:${id}`).digest('hex').slice(0, 8), 16) /
    0x1_0000_0000

const MINUTE = 60_000
const round1 = (kg: number) => Math.round(kg * 10) / 10

// Finishing holds of the demo's sport (demo content only, never in code paths).
const FINISHES = ['Удушающий сзади', 'Рычаг локтя', 'Треугольник', 'Кимура', 'Гильотина', 'Ущемление ахилла', 'Удушение «эзекиль»']
const KIDS_FINISHES = ['Рычаг локтя', 'Удушающий сзади', 'Треугольник']

type DivisionRow = {
    id: string
    slug: string
    tournamentId: string
    name: string
    sortOrder: number
    criteria: DivisionCriteria
    levelLabel: string | null
    mat: number | null
    matOrder: number | null
    drawNo: number
    drawnAt: Date | null
    finishedAt: Date | null
    createdAt: Date
}

type EntryRow = {
    id: string
    tournamentId: string
    registrationId: string
    userId: string
    workspaceId: string
    divisionId: string | null
    status: 'DECLARED' | 'CONFIRMED' | 'WITHDRAWN'
    sex: CompetitorSex
    birthYear: number
    declaredWeightG: number | null
    declaredById: string | null
    templateLevelId: string | null
    levelName: string | null
    levelSetById: string | null
    confirmedById: string | null
    confirmedAt: Date | null
    weighedWeightG: number | null
    weighedAt: Date | null
    weighedById: string | null
    withdrawnReason: string | null
    place: number | null
    createdAt: Date
    role?: 'student' | 'misha'
}

type MatchRow = {
    id: string
    divisionId: string
    tournamentId: string
    round: number
    position: number
    entryAId: string | null
    entryBId: string | null
    isBye: boolean
    winnerEntryId: string | null
    method: MethodName | null
    scoreA: number | null
    scoreB: number | null
    note: string | null
    decidedAt: Date | null
    decidedById: string | null
    createdAt: Date
}

export const buildDemoTournamentRows = (input: DemoTournamentInput): DemoTournamentRows => {
    const { now, timezone: tz, clubs } = input
    const today = localDateInTz(now, tz)
    const ago = (days: number) => addDaysYmd(today, -days)
    const at = (ymd: string, hm: string) => wallClockToUtc(`${ymd}T${hm}`, tz)
    const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MINUTE)
    const orgId = input.organizationId
    const fed = input.federation
    const sec = input.secretary
    const rows: DemoTournamentRows = {
        events: [],
        registrations: [],
        tournaments: [],
        divisions: [],
        entries: [],
        matches: [],
        auditEvents: [],
        dispatchClaims: [],
    }
    const audit = (action: string, targetId: string, createdAt: Date, metadata: Prisma.InputJsonValue, by: { id: string; email: string }) =>
        rows.auditEvents.push({
            organizationId: orgId,
            workspaceId: null,
            actorId: by.id,
            actorEmail: by.email,
            action,
            targetType: 'tournament',
            targetId,
            metadata,
            createdAt,
        })
    const coachOf = (workspaceId: string) =>
        (workspaceId === clubs.academy?.id ? clubs.academy : workspaceId === clubs.berkut?.id ? clubs.berkut : null)?.coachId ?? null
    const linked = new Set([clubs.academy?.id, clubs.berkut?.id].filter((id): id is string => !!id))
    const people = input.people.filter((p) => linked.has(p.workspaceId) && (!p.isChild || p.guardianId))
    const templateOf = (key: DemoOrgTemplateKey) => input.templates.find((t) => t.key === key)

    // ---- divisions ----------------------------------------------------------------
    const divisionsFor = (key: DemoTournamentKey, createdAt: Date): DivisionRow[] =>
        DEMO_DIVISIONS.map((d, i) => {
            const template = d.template ? templateOf(d.template) : undefined
            const criteria: DivisionCriteria = {
                sex: d.sex,
                ageMin: d.ageMin,
                ageMax: d.ageMax,
                templateId: template?.id ?? null,
                levelOrderFrom: template ? d.levelFrom : null,
                levelOrderTo: template ? d.levelTo : null,
                weightMinG: d.minKg === null ? null : kgToGrams(d.minKg),
                weightMaxG: d.maxKg === null ? null : kgToGrams(d.maxKg),
            }
            const levelLabel = template ? levelRangeLabel([...template.levels], d.levelFrom, d.levelTo) : null
            return {
                id: demoDivisionId(key, d.slug),
                slug: d.slug,
                tournamentId: demoTournamentId(key),
                name: divisionName(criteria, levelLabel),
                sortOrder: i + 1,
                criteria,
                levelLabel,
                mat: null,
                matOrder: null,
                drawNo: 0,
                drawnAt: null,
                finishedAt: null,
                createdAt,
            }
        })

    // ---- who fits where ---------------------------------------------------------------
    // A person's weight is stable across the season, a little different per
    // tournament.
    const baseKg = (p: DemoTournamentPerson, eventDate: string): number => {
        if (p.role === 'student') return 78.4
        const d = draw('weight', p.userId)
        if (p.isChild) return 14 + ageFor(p.birthYear, eventDate) * 2.7 + d * 8
        return p.sex === 'MALE' ? 62 + d * 38 : 52 + d * 22
    }
    const weightG = (p: DemoTournamentPerson, key: DemoTournamentKey, eventDate: string) =>
        kgToGrams(round1(baseKg(p, eventDate) + (p.role === 'student' ? 0 : (draw(`weight:${key}`, p.userId) - 0.5) * 1.6)))
    const levelOf = (p: DemoTournamentPerson) => {
        if (!p.level) return null
        const t = templateOf(p.level.template)
        const lv = t?.levels.find((l) => l.order === p.level!.order)
        return t && lv ? { templateId: t.id, order: lv.order, levelId: lv.id, name: lv.name } : null
    }
    const divisionOf = (p: DemoTournamentPerson, divisions: DivisionRow[], eventDate: string, w: number) => {
        const lv = levelOf(p)
        return matchDivision(
            { sex: p.sex, age: ageFor(p.birthYear, eventDate), weightG: w, level: lv ? { templateId: lv.templateId, order: lv.order } : null },
            divisions.map((d) => ({ ...d.criteria, id: d.id })),
        )
    }

    // Registration + entry for the two cup stages: whoever booked declared
    // the weight; the club's coach confirmed it (at once when he booked).
    const bookerOf = (p: DemoTournamentPerson, salt: string) => {
        const coach = coachOf(p.workspaceId) ?? p.userId
        if (p.role === 'student') return p.userId
        if (p.role === 'misha') return p.guardianId as string
        const r = draw(`booked-by:${salt}`, p.userId)
        return p.isChild ? (r < 0.5 ? (p.guardianId as string) : coach) : r < 0.65 ? p.userId : coach
    }
    const newEntry = (
        key: DemoTournamentKey,
        p: DemoTournamentPerson,
        registrationId: string,
        division: DivisionRow | null,
        e: { declaredG: number; declaredById: string; declaredAt: Date; confirmedAt: Date | null },
    ): EntryRow => {
        const lv = levelOf(p)
        const confirmed = e.confirmedAt !== null
        return {
            id: demoEntryId(key, p.userId),
            tournamentId: demoTournamentId(key),
            registrationId,
            userId: p.userId,
            workspaceId: p.workspaceId,
            divisionId: confirmed ? (division?.id ?? null) : null,
            status: confirmed ? 'CONFIRMED' : 'DECLARED',
            sex: p.sex,
            birthYear: p.birthYear,
            declaredWeightG: e.declaredG,
            declaredById: e.declaredById,
            templateLevelId: confirmed ? (lv?.levelId ?? null) : null,
            levelName: confirmed ? (lv?.name ?? null) : null,
            levelSetById: null,
            confirmedById: confirmed ? (e.declaredById === coachOf(p.workspaceId) ? e.declaredById : coachOf(p.workspaceId)) : null,
            confirmedAt: e.confirmedAt,
            weighedWeightG: null,
            weighedAt: null,
            weighedById: null,
            withdrawnReason: null,
            place: null,
            createdAt: e.declaredAt,
            role: p.role,
        }
    }

    // Picks the entrants of a cup stage: everyone who fits a division, the
    // script's people first, then by a draw, at most CAP per division.
    const pickEntrants = (key: 'autumn' | 'cup', divisions: DivisionRow[], eventDate: string) => {
        const byDivision = new Map<string, { p: DemoTournamentPerson; w: number }[]>()
        for (const p of people) {
            const w = weightG(p, key, eventDate)
            const d = divisionOf(p, divisions, eventDate, w)
            if (!d) continue
            byDivision.set(d.id, [...(byDivision.get(d.id) ?? []), { p, w }])
        }
        return divisions.flatMap((d) =>
            (byDivision.get(d.id) ?? [])
                .sort((a, b) => (a.p.role ? -1 : 0) - (b.p.role ? -1 : 0) || draw(`${key}:pick`, a.p.userId) - draw(`${key}:pick`, b.p.userId))
                .slice(0, CAP[key])
                .map((x) => ({ ...x, division: d })),
        )
    }

    // ---- brackets -------------------------------------------------------------------
    const drawDivision = (d: DivisionRow, entries: EntryRow[], drawnAt: Date, matches: MatchRow[]) => {
        d.drawNo = 1
        d.drawnAt = drawnAt
        const inDivision = entries.filter((e) => e.divisionId === d.id && e.status === 'CONFIRMED')
        if (inDivision.length === 0) {
            d.drawNo = 0
            d.drawnAt = null
            return
        }
        if (inDivision.length === 1) {
            // A lone athlete is 1st «без соперника» at the draw.
            inDivision[0].place = 1
            d.finishedAt = drawnAt
            return
        }
        const slots = seedBracket(
            inDivision.map((e) => ({ id: e.id, clubId: e.workspaceId })),
            `${d.id}:${d.drawNo}`,
        )
        const size = bracketSize(inDivision.length)
        const rounds = roundCount(size)
        const made: MatchRow[] = []
        for (let round = 1; round <= rounds; round++) {
            for (let position = 1; position <= size / 2 ** round; position++) {
                made.push({
                    id: demoUuid(`org:tomsk:tournament:${d.tournamentId}:match:${d.slug}:${round}:${position}`),
                    divisionId: d.id,
                    tournamentId: d.tournamentId,
                    round,
                    position,
                    entryAId: null,
                    entryBId: null,
                    isBye: false,
                    winnerEntryId: null,
                    method: null,
                    scoreA: null,
                    scoreB: null,
                    note: null,
                    decidedAt: null,
                    decidedById: null,
                    createdAt: drawnAt,
                })
            }
        }
        const find = (round: number, position: number) => made.find((m) => m.round === round && m.position === position)!
        for (const f of firstRoundMatches(slots)) {
            const m = find(1, f.position)
            m.entryAId = f.entryAId
            m.entryBId = f.entryBId
            m.isBye = f.isBye
            if (f.isBye) {
                m.winnerEntryId = f.entryAId ?? f.entryBId
                m.decidedAt = drawnAt
                m.decidedById = sec.id
                advance(made, m, rounds)
            }
        }
        matches.push(...made)
    }
    const advance = (matches: MatchRow[], m: MatchRow, rounds: number) => {
        if (m.round >= rounds) return
        const next = nextSlot(m.round, m.position)
        const target = matches.find((x) => x.divisionId === m.divisionId && x.round === next.round && x.position === next.position)!
        if (next.side === 'A') target.entryAId = m.winnerEntryId
        else target.entryBId = m.winnerEntryId
    }

    // Decides one ready match: the winner by a draw, except the script's
    // people (`lose` says where they go out), a method and a score that fit it.
    const decide = (
        key: DemoTournamentKey,
        m: MatchRow,
        ctx: { divisions: DivisionRow[]; entries: EntryRow[]; matches: MatchRow[]; decidedAt: Date; lose: (role: 'student' | 'misha', round: number, rounds: number) => boolean },
    ) => {
        const d = ctx.divisions.find((x) => x.id === m.divisionId)!
        const inDivision = ctx.entries.filter((e) => e.divisionId === d.id && e.status === 'CONFIRMED')
        const rounds = roundCount(bracketSize(inDivision.length))
        const a = ctx.entries.find((e) => e.id === m.entryAId)!
        const b = ctx.entries.find((e) => e.id === m.entryBId)!
        const fixed = a.role ?? b.role
        let aWins = draw(`${key}:win`, m.id) < 0.5
        let forcedLoss = false
        if (a.role) {
            forcedLoss = ctx.lose(a.role, m.round, rounds)
            aWins = !forcedLoss
        } else if (b.role) {
            forcedLoss = ctx.lose(b.role, m.round, rounds)
            aWins = forcedLoss
        }
        const early = m.round < rounds - 1
        const r = draw(`${key}:method`, m.id)
        const method: MethodName = forcedLoss
            ? 'POINTS'
            : early && !fixed && r < 0.04
              ? 'WALKOVER'
              : early && !fixed && r < 0.07
                ? 'DISQUALIFICATION'
                : r < 0.45
                  ? 'FINISH'
                  : r < 0.87
                    ? 'POINTS'
                    : 'DECISION'
        let win: number | null = null
        let lose: number | null = null
        if (method === 'POINTS') {
            win = 2 + 2 * Math.floor(draw(`${key}:score`, m.id) * 5)
            lose = 2 * Math.floor(draw(`${key}:score-l`, m.id) * (win / 2))
        } else if (method === 'DECISION') {
            win = 2 * Math.floor(draw(`${key}:score`, m.id) * 3)
            lose = win
        }
        const kids = d.criteria.ageMax !== null && d.criteria.ageMax < 18
        const finishes = kids ? KIDS_FINISHES : FINISHES
        m.winnerEntryId = aWins ? a.id : b.id
        m.method = method
        m.scoreA = aWins ? win : lose
        m.scoreB = aWins ? lose : win
        m.note = method === 'FINISH' ? finishes[Math.floor(draw(`${key}:finish`, m.id) * finishes.length)] : null
        m.decidedAt = ctx.decidedAt
        m.decidedById = sec.id
        advance(ctx.matches, m, rounds)
        audit('tournament.matchResult', d.tournamentId, ctx.decidedAt, {
            tournamentId: d.tournamentId,
            divisionId: d.id,
            divisionName: d.name,
            matchId: m.id,
            round: m.round,
            position: m.position,
            method,
        }, sec)
        if (m.round === rounds) {
            const divMatches = ctx.matches.filter((x) => x.divisionId === d.id)
            const places = placingsFor(divMatches, inDivision.map((e) => e.id))
            for (const e of inDivision) e.place = places.get(e.id) ?? null
            d.finishedAt = ctx.decidedAt
        }
    }

    // The mats: longest division first onto the least-loaded mat; queues by
    // sortOrder. `pin` puts one division second on its mat (after one other).
    const assignMats = (divisions: DivisionRow[], entries: EntryRow[], matCount: number, pin?: { divisionId: string; mat: number }) => {
        const played = (d: DivisionRow) => Math.max(0, entries.filter((e) => e.divisionId === d.id && e.status === 'CONFIRMED').length - 1)
        const drawn = divisions.filter((d) => d.drawnAt)
        const load = new Map<number, number>(Array.from({ length: matCount }, (_, i) => [i + 1, 0]))
        const onMat = new Map<number, DivisionRow[]>(Array.from({ length: matCount }, (_, i) => [i + 1, []]))
        const pinned = pin ? drawn.find((d) => d.id === pin.divisionId) : undefined
        if (pinned && pin) {
            onMat.get(pin.mat)!.push(pinned)
            load.set(pin.mat, played(pinned))
        }
        const rest = drawn.filter((d) => d !== pinned).sort((x, y) => played(y) - played(x) || x.sortOrder - y.sortOrder)
        for (const d of rest) {
            const mat = [...load.entries()].sort((x, y) => x[1] - y[1] || x[0] - y[0])[0][0]
            onMat.get(mat)!.push(d)
            load.set(mat, load.get(mat)! + played(d))
        }
        for (const [mat, list] of onMat) {
            const ordered = [...list].sort((x, y) => x.sortOrder - y.sortOrder)
            if (pinned && pin?.mat === mat) {
                // One division before the pinned one (the first by sortOrder).
                const others = ordered.filter((d) => d !== pinned)
                ordered.splice(0, ordered.length, ...others.slice(0, 1), pinned, ...others.slice(1))
            }
            ordered.forEach((d, i) => {
                d.mat = mat
                d.matOrder = i + 1
            })
        }
    }

    // Runs one mat from `start`, a match every DEMO_MATCH_MINUTES, until
    // `stop` says so or the queue is empty.
    const runMat = (
        key: DemoTournamentKey,
        mat: number,
        start: Date,
        ctx: { divisions: DivisionRow[]; entries: EntryRow[]; matches: MatchRow[]; lose: (role: 'student' | 'misha', round: number, rounds: number) => boolean },
        stop: (decided: number) => boolean,
    ) => {
        for (let i = 0; ; i++) {
            if (stop(i)) return
            const queue = matQueue(ctx.divisions, ctx.matches, mat)
            if (queue.length === 0) return
            decide(key, queue[0], { ...ctx, decidedAt: plus(start, DEMO_MATCH_MINUTES * (i + 1)) })
        }
    }

    const event = (key: 'autumn' | 'cup', e: Omit<Prisma.OrganizationEventCreateManyInput, 'id' | 'organizationId' | 'timezone' | 'createdById' | 'kind'>) => {
        const id = demoTournamentEventId(key)
        rows.events.push({ id, organizationId: orgId, timezone: tz, createdById: fed.id, kind: 'COMPETITION', ...e })
        rows.auditEvents.push({
            organizationId: orgId,
            workspaceId: null,
            actorId: fed.id,
            actorEmail: fed.email,
            action: 'org.eventCreate',
            targetType: 'organizationEvent',
            targetId: id,
            metadata: { title: e.title },
            createdAt: e.createdAt as Date,
        })
        return id
    }

    // A cup stage: event, registrations, entries, weigh-in, draw.
    const stage = (
        key: 'autumn' | 'cup',
        s: { eventId: string; startAt: Date; createdAt: Date; closesAt: Date; divisions: DivisionRow[] },
    ) => {
        const eventDate = localDateInTz(s.startAt, tz)
        const picked = pickEntrants(key, s.divisions, eventDate)
        const entries: EntryRow[] = []
        picked.forEach(({ p, w, division }, i) => {
            const booker = bookerOf(p, key)
            // Bookings spread over the weeks before the closing.
            const window = s.closesAt.getTime() - s.createdAt.getTime()
            const bookedAt = new Date(s.createdAt.getTime() + Math.floor(window * (0.1 + 0.8 * draw(`${key}:booked-at`, p.userId))))
            const registrationId = demoUuid(`org:tomsk:registration:${key}:${p.userId}`)
            rows.registrations.push({
                id: registrationId,
                eventId: s.eventId,
                userId: p.userId,
                workspaceId: p.workspaceId,
                status: 'BOOKED',
                bookedById: booker,
                createdAt: bookedAt,
            })
            const byCoach = booker === coachOf(p.workspaceId)
            const confirmedAt = byCoach ? bookedAt : new Date(Math.min(s.closesAt.getTime() - MINUTE, bookedAt.getTime() + (6 + i % 20) * 60 * MINUTE))
            entries.push(newEntry(key, p, registrationId, division, { declaredG: w, declaredById: booker, declaredAt: bookedAt, confirmedAt }))
        })
        return entries
    }

    // The weigh-in an hour before the start: the secretary records the
    // weight; it is the declared one ± a little, within the division.
    const weighIn = (entries: EntryRow[], divisions: DivisionRow[], startAt: Date, key: DemoTournamentKey) => {
        const opens = plus(startAt, -60)
        entries
            .filter((e) => e.status === 'CONFIRMED')
            .forEach((e, i) => {
                const d = divisions.find((x) => x.id === e.divisionId)!
                let g = e.declaredWeightG! + Math.round((draw(`${key}:weighed`, e.userId) - 0.6) * 8) * 100
                if (d.criteria.weightMaxG !== null && g > d.criteria.weightMaxG) g = d.criteria.weightMaxG
                if (d.criteria.weightMinG !== null && g <= d.criteria.weightMinG) g = d.criteria.weightMinG + 100
                e.weighedWeightG = g
                e.weighedAt = plus(opens, Math.min(50, Math.floor(i / 2)))
                e.weighedById = sec.id
            })
    }

    const tournament = (key: DemoTournamentKey, t: Omit<Prisma.TournamentCreateManyInput, 'id' | 'organizationId' | 'createdById'>) => {
        const id = demoTournamentId(key)
        rows.tournaments.push({ id, organizationId: orgId, createdById: fed.id, ...t })
        audit('tournament.create', id, t.createdAt as Date, { tournamentId: id, eventId: t.eventId, matCount: t.matCount ?? 1 }, fed)
        return id
    }
    const statusChange = (id: string, fromStatus: string, toStatus: string, when: Date, extra: Record<string, number> = {}) =>
        audit('tournament.statusChange', id, when, { tournamentId: id, fromStatus, toStatus, ...extra }, sec)
    // «Начать турнир»: the unweighed withdrawn, every division with entries drawn.
    const started = (id: string, entries: EntryRow[], divisions: DivisionRow[], when: Date) =>
        statusChange(id, 'WEIGH_IN', 'RUNNING', when, {
            withdrawnCount: entries.filter((e) => e.withdrawnReason === 'Не взвешен').length,
            drawnCount: divisions.filter((d) => d.drawnAt).length,
        })

    const flush = (divisions: DivisionRow[], entries: EntryRow[], matches: MatchRow[]) => {
        rows.divisions.push(
            ...divisions.map((d) => ({
                id: d.id,
                tournamentId: d.tournamentId,
                name: d.name,
                sortOrder: d.sortOrder,
                ...d.criteria,
                levelLabel: d.levelLabel,
                mat: d.mat,
                matOrder: d.matOrder,
                drawNo: d.drawNo,
                drawnAt: d.drawnAt,
                finishedAt: d.finishedAt,
                createdAt: d.createdAt,
            })),
        )
        rows.entries.push(...entries.map(({ role: _role, ...e }) => e))
        rows.matches.push(...matches)
    }

    // ---- «Кубок федерации, 1-й этап»: finished, published ------------------------------
    {
        const day = ago(DEMO_AUTUMN_DAYS_AGO)
        const startAt = at(day, '10:00')
        const createdAt = at(addDaysYmd(day, -35), '11:00')
        const closesAt = at(addDaysYmd(day, -3), '23:59')
        const eventId = event('autumn', {
            title: DEMO_TOURNAMENT_TITLES.autumn,
            description: 'Первый этап Кубка федерации: взрослые по поясам и весу, женщины и дети в абсолютной категории. Итоги опубликованы.',
            startAt,
            endAt: at(day, '18:00'),
            place: clubs.berkut ? 'Клуб «Беркут», спортзал «Олимп»' : 'СК «Дворец спорта»',
            address: null,
            hostWorkspaceId: clubs.berkut?.id ?? clubs.academy?.id ?? null,
            audience: 'STAFF_AND_MEMBERS',
            capacity: 120,
            registrationOpen: true,
            registrationClosesAt: closesAt,
            feeNote: 'Взнос 1 000 ₽ на месте',
            publishedAt: plus(createdAt, 30),
            createdAt,
        })
        const published = at(day, '19:00')
        const id = tournament('autumn', { eventId, status: 'FINISHED', matCount: AUTUMN_MATS, resultsPublishedAt: published, createdAt: plus(createdAt, 10) })
        const divisions = divisionsFor('autumn', plus(createdAt, 20))
        audit('tournament.divisionsCreate', id, plus(createdAt, 20), { tournamentId: id, count: divisions.length }, fed)
        const entries = stage('autumn', { eventId, startAt, createdAt, closesAt, divisions })
        statusChange(id, 'SETUP', 'WEIGH_IN', plus(startAt, -70))
        weighIn(entries, divisions, startAt, 'autumn')
        const matches: MatchRow[] = []
        for (const d of divisions) drawDivision(d, entries, startAt, matches)
        started(id, entries, divisions, startAt)
        assignMats(divisions, entries, AUTUMN_MATS)
        const ctx = {
            divisions,
            entries,
            matches,
            // student@ goes out in the semifinal (3rd), Миша in the final (2nd).
            lose: (role: 'student' | 'misha', round: number, rounds: number) => (role === 'student' ? round === rounds - 1 : round === rounds),
        }
        for (let mat = 1; mat <= AUTUMN_MATS; mat++) runMat('autumn', mat, startAt, ctx, () => false)
        audit('tournament.publish', id, published, { tournamentId: id }, fed)
        // The 30-day retention has run: the weights are gone, places stay.
        for (const e of entries) {
            e.declaredWeightG = null
            e.weighedWeightG = null
            rows.dispatchClaims.push({ kind: 'tournament.results_published', refId: e.id })
        }
        flush(divisions, entries, matches)
    }

    // ---- «Кубок федерации, 2-й этап»: running now ------------------------------------
    {
        const tenMinutes = 10 * MINUTE
        const startAt = new Date(Math.floor((now.getTime() - 120 * MINUTE) / tenMinutes) * tenMinutes)
        const day = localDateInTz(startAt, tz)
        const createdAt = at(ago(30), '11:00')
        const closesAt = at(addDaysYmd(day, -3), '23:59')
        const eventId = event('cup', {
            title: DEMO_TOURNAMENT_TITLES.cup,
            description: 'Второй этап Кубка федерации. Категории — как на первом этапе. Взвешивание за час до начала.',
            startAt,
            endAt: plus(startAt, 8 * 60),
            place: clubs.academy ? 'СК «Дворец спорта»' : 'Спортзал «Олимп»',
            address: clubs.academy ? 'Томск, ул. Красноармейская, 126' : null,
            hostWorkspaceId: clubs.academy?.id ?? clubs.berkut?.id ?? null,
            audience: 'STAFF_AND_MEMBERS',
            capacity: 120,
            registrationOpen: true,
            registrationClosesAt: closesAt,
            feeNote: 'Взнос 1 000 ₽ на месте',
            publishedAt: plus(createdAt, 30),
            createdAt,
        })
        const id = tournament('cup', { eventId, status: 'RUNNING', matCount: DEMO_CUP_MATS, resultsPublishedAt: null, createdAt: plus(createdAt, 10) })
        const divisions = divisionsFor('cup', plus(createdAt, 20))
        audit('tournament.divisionsCopy', id, plus(createdAt, 20), { tournamentId: id, fromTournamentId: demoTournamentId('autumn'), count: divisions.length }, fed)
        const entries = stage('cup', { eventId, startAt, createdAt, closesAt, divisions })
        statusChange(id, 'SETUP', 'WEIGH_IN', plus(startAt, -70))
        weighIn(entries, divisions, startAt, 'cup')

        // One athlete came in over the weight he declared and was moved up
        // one division at the scale.
        const moved = entries
            .filter((e) => !e.role && e.status === 'CONFIRMED')
            .map((e) => {
                const d = divisions.find((x) => x.id === e.divisionId)!
                const up = divisions.find(
                    (x) =>
                        x !== d &&
                        x.criteria.sex === d.criteria.sex &&
                        x.criteria.templateId === d.criteria.templateId &&
                        x.criteria.levelOrderFrom === d.criteria.levelOrderFrom &&
                        x.criteria.ageMin === d.criteria.ageMin &&
                        d.criteria.weightMaxG !== null &&
                        x.criteria.weightMinG === d.criteria.weightMaxG,
                )
                return { e, d, up }
            })
            .filter((x) => x.up && x.d.slug !== DEMO_STUDENT_CUP_DIVISION && x.up.slug !== DEMO_STUDENT_CUP_DIVISION)
            .sort((x, y) => draw('cup:moved', x.e.userId) - draw('cup:moved', y.e.userId))[0]
        if (moved?.up) {
            const limit = moved.d.criteria.weightMaxG!
            moved.e.declaredWeightG = limit - 500
            moved.e.weighedWeightG = limit + 700
            moved.e.divisionId = moved.up.id
            audit('tournament.entryMove', id, plus(moved.e.weighedAt!, 1), {
                tournamentId: id,
                entryId: moved.e.id,
                fromDivisionId: moved.d.id,
                toDivisionId: moved.up.id,
                fromDivisionName: moved.d.name,
                toDivisionName: moved.up.name,
            }, sec)
        }
        // One confirmed athlete never came to the scale: «Начать турнир»
        // withdrew him.
        const absent = entries
            .filter((e) => !e.role && e.status === 'CONFIRMED' && e !== moved?.e && e.divisionId !== demoDivisionId('cup', DEMO_STUDENT_CUP_DIVISION))
            .sort((x, y) => draw('cup:absent', x.userId) - draw('cup:absent', y.userId))[0]
        if (absent) {
            absent.status = 'WITHDRAWN'
            absent.withdrawnReason = 'Не взвешен'
            absent.weighedWeightG = null
            absent.weighedAt = null
            absent.weighedById = null
        }
        const matches: MatchRow[] = []
        for (const d of divisions) drawDivision(d, entries, startAt, matches)
        started(id, entries, divisions, startAt)
        const studentDivision = demoDivisionId('cup', DEMO_STUDENT_CUP_DIVISION)
        assignMats(divisions, entries, DEMO_CUP_MATS, { divisionId: studentDivision, mat: DEMO_STUDENT_MAT })
        const ctx = { divisions, entries, matches, lose: () => false }
        // A mat stops mid-way through its second division; mat 2 when
        // student@'s match is next but one and his division has begun.
        const maxPerMat = Math.floor((now.getTime() - startAt.getTime()) / (DEMO_MATCH_MINUTES * MINUTE))
        const played = (d: DivisionRow) => Math.max(0, entries.filter((e) => e.divisionId === d.id && e.status === 'CONFIRMED').length - 1)
        const student = entries.find((e) => e.role === 'student' && e.status === 'CONFIRMED')
        for (let mat = 1; mat <= DEMO_CUP_MATS; mat++) {
            const queue = divisions.filter((d) => d.mat === mat).sort((x, y) => (x.matOrder ?? 0) - (y.matOrder ?? 0))
            const target = Math.min(maxPerMat, played(queue[0] ?? ({} as DivisionRow)) + Math.max(1, Math.floor(played(queue[1] ?? queue[0] ?? ({} as DivisionRow)) / 2)))
            const studentReady = () => {
                if (!student) return false
                const next = nextMatchFor(student.id, divisions, matches)
                const begun = matches.some((m) => m.divisionId === student.divisionId && !m.isBye && m.winnerEntryId)
                return !!next && next.mat === mat && next.ahead === 1 && begun
            }
            const isStudentMat = student && divisions.find((d) => d.id === student.divisionId)?.mat === mat
            runMat('cup', mat, startAt, ctx, (decided) => decided >= maxPerMat || (isStudentMat ? studentReady() : decided >= target))
        }
        for (const e of entries) {
            if (e.status === 'CONFIRMED' && divisions.find((d) => d.id === e.divisionId)?.drawnAt) {
                rows.dispatchClaims.push({ kind: 'tournament.bracket_ready', refId: `${e.id}:1` })
            }
        }
        flush(divisions, entries, matches)
    }

    // ---- «Открытый турнир Томской области»: taking entries ------------------------------
    if (input.open) {
        const open = input.open
        const createdAt = plus(open.createdAt, 10)
        const eventDate = localDateInTz(open.startAt, tz)
        const id = tournament('open', { eventId: open.eventId, status: 'SETUP', matCount: OPEN_MATS, resultsPublishedAt: null, createdAt })
        const divisions = divisionsFor('open', plus(createdAt, 10))
        audit('tournament.divisionsCopy', id, plus(createdAt, 10), { tournamentId: id, fromTournamentId: demoTournamentId('cup'), count: divisions.length }, fed)
        const entries: EntryRow[] = []
        const candidates = open.registrations
            .map((r) => ({ r, p: people.find((p) => p.userId === r.userId) }))
            .filter((x): x is { r: DemoOpenRegistration; p: DemoTournamentPerson } => !!x.p)
            .map((x) => ({ ...x, w: weightG(x.p, 'open', eventDate) }))
            .map((x) => ({ ...x, division: divisionOf(x.p, divisions, eventDate, x.w) }))
            .filter((x) => x.division)
            .sort((a, b) => draw('open:entry', a.p.userId) - draw('open:entry', b.p.userId))
        // ACADEMY adults who declared their weight themselves wait for the
        // coach (coach@ sees «Ждут подтверждения: 3»).
        const declared = candidates
            .filter((x) => x.p.workspaceId === clubs.academy?.id && !x.p.isChild)
            .sort((a, b) => Number(b.r.bookedById === b.p.userId) - Number(a.r.bookedById === a.p.userId))
            .slice(0, DEMO_OPEN_DECLARED)
        const confirmed = candidates.filter((x) => !declared.includes(x)).slice(0, DEMO_OPEN_CONFIRMED)
        const declaredAt = (r: DemoOpenRegistration, salt: string) =>
            new Date(Math.min(now.getTime() - 30 * MINUTE, r.createdAt.getTime() + Math.floor((2 + draw(salt, r.userId) * 20) * 60 * MINUTE)))
        for (const x of declared) {
            entries.push(
                newEntry('open', x.p, x.r.id, null, { declaredG: x.w, declaredById: x.p.userId, declaredAt: declaredAt(x.r, 'open:declared'), confirmedAt: null }),
            )
        }
        for (const x of confirmed) {
            const coach = coachOf(x.p.workspaceId)
            const byCoach = x.r.bookedById === coach
            const when = declaredAt(x.r, 'open:declared')
            const confirmedAt = byCoach ? when : new Date(Math.min(now.getTime() - 10 * MINUTE, when.getTime() + 5 * 60 * MINUTE))
            entries.push(
                newEntry('open', x.p, x.r.id, divisions.find((d) => d.id === x.division!.id)!, {
                    declaredG: x.w,
                    declaredById: byCoach ? (coach as string) : x.p.isChild ? (x.p.guardianId as string) : x.p.userId,
                    declaredAt: when,
                    confirmedAt,
                }),
            )
        }
        flush(divisions, entries, [])
    }

    rows.auditEvents.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())
    return rows
}

// The demo has no sex on a person: Russian surnames say it («Иванова»,
// «Ковалёва», «Белая»); without one, a first name in -а/-я that is not a
// man's short name.
const MALE_SHORT_NAMES = new Set(['миша', 'никита', 'илья', 'саша', 'дима', 'лёва', 'лева', 'фома', 'кузьма', 'савва', 'данила', 'гоша', 'паша', 'коля', 'ваня', 'петя', 'вова', 'серёжа', 'сережа', 'лёша', 'леша', 'женя'])
export const sexFromName = (firstname: string | null, lastname: string | null): CompetitorSex => {
    const last = (lastname ?? '').trim().toLowerCase()
    if (/(ова|ева|ёва|ина|ына|ая|яя)$/.test(last)) return 'FEMALE'
    if (/(ов|ев|ёв|ин|ын|ий|ой|ый)$/.test(last)) return 'MALE'
    const first = (firstname ?? '').trim().toLowerCase()
    return /[ая]$/.test(first) && !MALE_SHORT_NAMES.has(first) ? 'FEMALE' : 'MALE'
}
