// The allow-listed readers of federation tournaments (design
// docs/design/2026-11-27-tournaments.md §4.5, §2.3). The one place that
// decides what each audience sees:
//   - names and clubs only for people with a live federation consent at the
//     tournament edition (own or a confirmed guardian's) whose club is still
//     ACTIVE in the org — everyone else is «Участник скрыт», no club, and
//     the bracket keeps its shape;
//   - weights and birth year only for the org, the athlete's own club coach
//     and the athlete / guardian;
//   - member-audience rows carry no user id, weight or birth year.
import { localDateInTz } from '../../features/attendance/attendance-utils'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'
import { consentedPersonIds, TOURNAMENT_CONSENT_MIN_VERSION } from '../organizations/consent'
import { bracketSize, nextSlot, roundCount } from './bracket'
import { entryWeightG, fitsWeight } from './divisions'
import { isReady, nextMatchFor, type ScheduleDivision, type ScheduleMatch } from './schedule'

type ReadClient = Pick<
    PrismaService,
    | 'tournament'
    | 'tournamentDivision'
    | 'tournamentEntry'
    | 'tournamentMatch'
    | 'organizationClub'
    | 'consentRecord'
    | 'guardianship'
>

export type PersonPodium = {
    userId: string
    eventId: string
    tournamentTitle: string
    // The event's local date.
    date: string
    divisionName: string
    place: number
}

// Published podiums of `userIds` in this org's tournaments, newest first.
// The caller decides who may see them (own data: always; the registry: the
// people it lists with a tournament-edition consent).
export const personPodiums = async (
    prisma: Pick<PrismaService, 'tournamentEntry'>,
    organizationId: string,
    userIds: string[],
): Promise<PersonPodium[]> => {
    if (userIds.length === 0) return []
    const rows = await prisma.tournamentEntry.findMany({
        where: {
            userId: { in: userIds },
            place: { not: null },
            tournament: {
                organizationId,
                status: 'FINISHED',
                resultsPublishedAt: { not: null },
            },
        },
        select: {
            userId: true,
            place: true,
            division: { select: { name: true } },
            tournament: {
                select: {
                    event: { select: { id: true, title: true, startAt: true, timezone: true } },
                },
            },
        },
        orderBy: [{ tournament: { event: { startAt: 'desc' } } }, { place: 'asc' }],
    })
    return rows.map((r) => ({
        userId: r.userId,
        eventId: r.tournament.event.id,
        tournamentTitle: r.tournament.event.title,
        date: localDateInTz(r.tournament.event.startAt, r.tournament.event.timezone),
        divisionName: r.division?.name ?? '',
        place: r.place!,
    }))
}

// Who of `userIds` (entrants through `workspaceIds`) shows by name: the
// tournament-edition consent and the club still ACTIVE in the org.
export const visiblePeople = async (
    prisma: Pick<ReadClient, 'organizationClub' | 'consentRecord' | 'guardianship'>,
    organizationId: string,
    entries: Array<{ userId: string; workspaceId: string }>,
): Promise<(e: { userId: string; workspaceId: string }) => boolean> => {
    const userIds = [...new Set(entries.map((e) => e.userId))]
    const [consented, links] = await Promise.all([
        consentedPersonIds(prisma, organizationId, userIds, {
            minVersion: TOURNAMENT_CONSENT_MIN_VERSION,
        }),
        prisma.organizationClub.findMany({
            where: { organizationId, status: 'ACTIVE' },
            select: { workspaceId: true },
        }),
    ])
    const active = new Set(links.map((l) => l.workspaceId))
    return (e) => consented.has(e.userId) && active.has(e.workspaceId)
}

export const SCHEDULE_DIVISION_SELECT = {
    id: true,
    sortOrder: true,
    mat: true,
    matOrder: true,
} as const

export const SCHEDULE_MATCH_SELECT = {
    id: true,
    divisionId: true,
    round: true,
    position: true,
    entryAId: true,
    entryBId: true,
    isBye: true,
    winnerEntryId: true,
} as const

// Divisions and matches of a tournament, enough for queues and next matches.
export const loadSchedule = async (
    prisma: Pick<ReadClient, 'tournamentDivision' | 'tournamentMatch'>,
    tournamentId: string,
): Promise<{ divisions: ScheduleDivision[]; matches: ScheduleMatch[] }> => {
    const [divisions, matches] = await Promise.all([
        prisma.tournamentDivision.findMany({
            where: { tournamentId },
            select: SCHEDULE_DIVISION_SELECT,
        }),
        prisma.tournamentMatch.findMany({
            where: { tournamentId },
            select: SCHEDULE_MATCH_SELECT,
        }),
    ])
    return { divisions, matches }
}

export type EntryLineState = {
    state: 'NEEDS_WEIGHT' | 'AWAITING_COACH' | 'CONFIRMED' | 'WITHDRAWN'
    divisionName: string | null
    mat: number | null
    ahead: number | null
    place: number | null
}

// The Events row line of one person per tournament event: «Укажите вес для
// заявки» / «Заявка у тренера» / division / «Ковёр 2 · перед вами 2» / place.
// Only for events where the person has a live booking through this club.
export const entryLineStates = async (
    prisma: Pick<ReadClient, 'tournamentEntry' | 'tournamentDivision' | 'tournamentMatch'>,
    p: {
        tournaments: Array<{ id: string; eventId: string; status: string }>
        bookedEventIds: Set<string>
        userId: string
    },
): Promise<Map<string, EntryLineState>> => {
    const out = new Map<string, EntryLineState>()
    const relevant = p.tournaments.filter((t) => p.bookedEventIds.has(t.eventId))
    if (relevant.length === 0) return out
    const entries = await prisma.tournamentEntry.findMany({
        where: { tournamentId: { in: relevant.map((t) => t.id) }, userId: p.userId },
        select: {
            id: true,
            tournamentId: true,
            status: true,
            place: true,
            division: { select: { name: true } },
        },
    })
    const byTournament = new Map(entries.map((e) => [e.tournamentId, e]))
    for (const t of relevant) {
        const e = byTournament.get(t.id)
        if (!e) {
            if (t.status === 'SETUP') {
                out.set(t.eventId, {
                    state: 'NEEDS_WEIGHT',
                    divisionName: null,
                    mat: null,
                    ahead: null,
                    place: null,
                })
            }
            continue
        }
        const state: EntryLineState = {
            state:
                e.status === 'DECLARED'
                    ? 'AWAITING_COACH'
                    : e.status === 'WITHDRAWN'
                      ? 'WITHDRAWN'
                      : 'CONFIRMED',
            divisionName: e.division?.name ?? null,
            mat: null,
            ahead: null,
            place: e.place,
        }
        if (t.status === 'RUNNING' && e.status === 'CONFIRMED' && e.place === null) {
            const { divisions, matches } = await loadSchedule(prisma, t.id)
            const next = nextMatchFor(e.id, divisions, matches)
            if (next) {
                state.mat = next.mat
                state.ahead = next.ahead
            }
        }
        out.set(t.eventId, state)
    }
    return out
}

// «Ждут подтверждения: N» per tournament: DECLARED entries of this club, of
// the coach's own students (`userIds`; null = admin scope, the whole club).
export const toConfirmCounts = async (
    prisma: Pick<PrismaService, 'tournamentEntry'>,
    p: { tournamentIds: string[]; workspaceId: string; userIds: string[] | null },
): Promise<Map<string, number>> => {
    if (p.tournamentIds.length === 0 || p.userIds?.length === 0) return new Map()
    const rows = await prisma.tournamentEntry.groupBy({
        by: ['tournamentId'],
        where: {
            tournamentId: { in: p.tournamentIds },
            workspaceId: p.workspaceId,
            status: 'DECLARED',
            ...(p.userIds ? { userId: { in: p.userIds } } : {}),
        },
        _count: { _all: true },
    })
    return new Map(rows.map((r) => [r.tournamentId, r._count._all]))
}

// ─── The tournament ──────────────────────────────────────────────────────

export const TOURNAMENT_SELECT = {
    id: true,
    organizationId: true,
    eventId: true,
    // The discipline's words in copy (tournament-words.ts).
    organization: { select: { type: true } },
    status: true,
    matCount: true,
    resultsPublishedAt: true,
    createdAt: true,
    updatedAt: true,
    event: {
        select: {
            title: true,
            startAt: true,
            endAt: true,
            timezone: true,
            place: true,
            registrationClosesAt: true,
        },
    },
} as const

export type TournamentRow = {
    id: string
    organizationId: string
    eventId: string
    organization: { type: string }
    status: 'SETUP' | 'WEIGH_IN' | 'RUNNING' | 'FINISHED'
    matCount: number
    resultsPublishedAt: Date | null
    createdAt: Date
    updatedAt: Date
    event: {
        title: string
        startAt: Date
        endAt: Date | null
        timezone: string
        place: string | null
        registrationClosesAt: Date | null
    }
}

// The org's tournament or 404 (another org's id included).
export const loadOrgTournament = async (
    prisma: Pick<PrismaService, 'tournament'>,
    organizationId: string,
    tournamentId: string,
): Promise<TournamentRow> => {
    const row = await prisma.tournament.findFirst({
        where: { id: tournamentId, organizationId },
        select: TOURNAMENT_SELECT,
    })
    if (!row) throw new NotFoundError({ message: 'Турнир не найден' })
    return row
}

export type TournamentCounts = {
    registrations: number
    declared: number
    confirmed: number
    withdrawn: number
    weighed: number
    unweighed: number
    unassigned: number
    divisions: number
    divisionsDrawn: number
    divisionsFinished: number
}

export const loadTournamentCounts = async (
    prisma: Pick<
        PrismaService,
        'organizationEventRegistration' | 'tournamentEntry' | 'tournamentDivision'
    >,
    t: { id: string; eventId: string },
): Promise<TournamentCounts> => {
    const [registrations, byStatus, weighed, unassigned, divisions, drawn, finished] =
        await Promise.all([
            prisma.organizationEventRegistration.count({
                where: { eventId: t.eventId, status: 'BOOKED' },
            }),
            prisma.tournamentEntry.groupBy({
                by: ['status'],
                where: { tournamentId: t.id },
                _count: { _all: true },
            }),
            prisma.tournamentEntry.count({
                where: { tournamentId: t.id, status: 'CONFIRMED', weighedWeightG: { not: null } },
            }),
            prisma.tournamentEntry.count({
                where: { tournamentId: t.id, status: 'CONFIRMED', divisionId: null },
            }),
            prisma.tournamentDivision.count({ where: { tournamentId: t.id } }),
            prisma.tournamentDivision.count({
                where: { tournamentId: t.id, drawnAt: { not: null } },
            }),
            prisma.tournamentDivision.count({
                where: { tournamentId: t.id, finishedAt: { not: null } },
            }),
        ])
    const status = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0
    return {
        registrations,
        declared: status('DECLARED'),
        confirmed: status('CONFIRMED'),
        withdrawn: status('WITHDRAWN'),
        weighed,
        unweighed: status('CONFIRMED') - weighed,
        unassigned,
        divisions,
        divisionsDrawn: drawn,
        divisionsFinished: finished,
    }
}

// ─── Divisions ───────────────────────────────────────────────────────────

export const DIVISION_SELECT = {
    id: true,
    tournamentId: true,
    name: true,
    sortOrder: true,
    sex: true,
    ageMin: true,
    ageMax: true,
    templateId: true,
    levelOrderFrom: true,
    levelOrderTo: true,
    levelLabel: true,
    weightMinG: true,
    weightMaxG: true,
    mat: true,
    matOrder: true,
    drawNo: true,
    drawnAt: true,
    finishedAt: true,
    updatedAt: true,
} as const

export type DivisionRow = {
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

export type DivisionView = DivisionRow & { entryCount: number; hasResults: boolean }

// Divisions with their non-withdrawn entry counts and whether a result is in.
export const loadDivisionViews = async (
    prisma: Pick<PrismaService, 'tournamentDivision' | 'tournamentEntry' | 'tournamentMatch'>,
    tournamentId: string,
    divisionIds?: string[],
): Promise<DivisionView[]> => {
    const where = {
        tournamentId,
        ...(divisionIds ? { id: { in: divisionIds } } : {}),
    }
    const [divisions, counts, decided] = await Promise.all([
        prisma.tournamentDivision.findMany({
            where,
            select: DIVISION_SELECT,
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.tournamentEntry.groupBy({
            by: ['divisionId'],
            where: {
                tournamentId,
                status: { not: 'WITHDRAWN' },
                ...(divisionIds ? { divisionId: { in: divisionIds } } : {}),
            },
            _count: { _all: true },
        }),
        prisma.tournamentMatch.groupBy({
            by: ['divisionId'],
            where: {
                tournamentId,
                isBye: false,
                decidedAt: { not: null },
                ...(divisionIds ? { divisionId: { in: divisionIds } } : {}),
            },
            _count: { _all: true },
        }),
    ])
    const countOf = new Map(counts.map((c) => [c.divisionId, c._count._all]))
    const withResults = new Set(decided.map((d) => d.divisionId))
    return divisions.map((d) => ({
        ...d,
        entryCount: countOf.get(d.id) ?? 0,
        hasResults: withResults.has(d.id),
    }))
}

export const loadDivisionView = async (
    prisma: Pick<PrismaService, 'tournamentDivision' | 'tournamentEntry' | 'tournamentMatch'>,
    tournamentId: string,
    divisionId: string,
): Promise<DivisionView> => {
    const [view] = await loadDivisionViews(prisma, tournamentId, [divisionId])
    if (!view) throw new NotFoundError({ message: 'Категория не найдена' })
    return view
}

// ─── People ──────────────────────────────────────────────────────────────

// One entry as the readers know it; `visible` per §2.3 (the tournament
// edition of the consent, the club still ACTIVE in the org).
export type EntryView = {
    id: string
    userId: string
    workspaceId: string
    visible: boolean
    personName: string
    clubName: string
    status: 'DECLARED' | 'CONFIRMED' | 'WITHDRAWN'
    sex: 'FEMALE' | 'MALE'
    birthYear: number
    declaredWeightG: number | null
    weighedWeightG: number | null
    weighedAt: Date | null
    divisionId: string | null
    templateLevelId: string | null
    levelName: string | null
    levelSetById: string | null
    confirmedAt: Date | null
    withdrawnReason: string | null
    place: number | null
    updatedAt: Date
}

const ENTRY_SELECT = {
    id: true,
    userId: true,
    workspaceId: true,
    status: true,
    sex: true,
    birthYear: true,
    declaredWeightG: true,
    weighedWeightG: true,
    weighedAt: true,
    divisionId: true,
    templateLevelId: true,
    levelName: true,
    levelSetById: true,
    confirmedAt: true,
    withdrawnReason: true,
    place: true,
    updatedAt: true,
    user: { select: { firstname: true, lastname: true } },
    workspace: { select: { name: true } },
} as const

// Entries of a tournament (optionally some), with names resolved per §2.3.
export const loadEntryViews = async (
    prisma: Pick<
        ReadClient,
        'tournamentEntry' | 'organizationClub' | 'consentRecord' | 'guardianship'
    >,
    organizationId: string,
    where: {
        tournamentId: string
        ids?: string[]
        divisionId?: string
        workspaceId?: string
        userIds?: string[]
    },
): Promise<EntryView[]> => {
    const rows = await prisma.tournamentEntry.findMany({
        where: {
            tournamentId: where.tournamentId,
            ...(where.ids ? { id: { in: where.ids } } : {}),
            ...(where.divisionId ? { divisionId: where.divisionId } : {}),
            ...(where.workspaceId ? { workspaceId: where.workspaceId } : {}),
            ...(where.userIds ? { userId: { in: where.userIds } } : {}),
        },
        select: ENTRY_SELECT,
    })
    const visible = await visiblePeople(prisma, organizationId, rows)
    return rows
        .map(({ user, workspace, ...e }) => ({
            ...e,
            visible: visible(e),
            personName: fullNameWithoutEmail(user),
            clubName: workspace.name,
            // A hidden person sorts by id: their surname must not leak
            // through the order of the «Участник скрыт» rows.
            sortKey: visible(e) ? `${user.lastname ?? ''} ${user.firstname ?? ''}` : e.id,
        }))
        .sort((a, b) =>
            a.visible !== b.visible ? (a.visible ? -1 : 1) : a.sortKey.localeCompare(b.sortKey, 'ru'),
        )
        .map(({ sortKey: _k, ...e }) => e)
}

export type EntryFilter = 'all' | 'unweighed' | 'offWeight' | 'unassigned' | 'withdrawn' | 'declared'

// «Участники» filters; a search finds visible people only (a hidden person
// has no name to find).
export const filterEntryViews = (
    entries: EntryView[],
    divisions: Map<string, { weightMinG: number | null; weightMaxG: number | null }>,
    o: { q?: string; divisionId?: string; filter?: EntryFilter },
): EntryView[] => {
    const q = o.q?.trim().toLocaleLowerCase('ru')
    return entries.filter((e) => {
        if (o.divisionId && e.divisionId !== o.divisionId) return false
        if (q && !(e.visible && e.personName.toLocaleLowerCase('ru').includes(q))) return false
        switch (o.filter ?? 'all') {
            case 'all':
                return e.status !== 'WITHDRAWN'
            case 'unweighed':
                return e.status === 'CONFIRMED' && e.weighedWeightG === null
            case 'offWeight': {
                const d = e.divisionId ? divisions.get(e.divisionId) : undefined
                return (
                    e.status === 'CONFIRMED' &&
                    e.weighedWeightG !== null &&
                    !!d &&
                    !fitsWeight(e.weighedWeightG, d)
                )
            }
            case 'unassigned':
                return e.status === 'CONFIRMED' && e.divisionId === null
            case 'withdrawn':
                return e.status === 'WITHDRAWN'
            case 'declared':
                return e.status === 'DECLARED'
        }
    })
}

// The current weight fits the division; null without a division or weight.
export const entryFits = (
    e: Pick<EntryView, 'declaredWeightG' | 'weighedWeightG'>,
    d: { weightMinG: number | null; weightMaxG: number | null } | undefined,
): boolean | null => {
    const w = entryWeightG(e)
    if (!d || w === null) return null
    return fitsWeight(w, d)
}

// ─── Brackets ────────────────────────────────────────────────────────────

export const MATCH_SELECT = {
    id: true,
    divisionId: true,
    round: true,
    position: true,
    entryAId: true,
    entryBId: true,
    isBye: true,
    winnerEntryId: true,
    method: true,
    scoreA: true,
    scoreB: true,
    note: true,
    decidedAt: true,
    updatedAt: true,
} as const

export type MatchRow = {
    id: string
    divisionId: string
    round: number
    position: number
    entryAId: string | null
    entryBId: string | null
    isBye: boolean
    winnerEntryId: string | null
    method: 'FINISH' | 'POINTS' | 'DECISION' | 'DISQUALIFICATION' | 'WALKOVER' | null
    scoreA: number | null
    scoreB: number | null
    note: string | null
    decidedAt: Date | null
    updatedAt: Date
}

export type BracketView = {
    division: DivisionView
    size: number
    rounds: number
    matches: Array<MatchRow & { ready: boolean; nextMatchId: string | null }>
    // Every entry the bracket names, plus (before the draw) the division's
    // non-withdrawn entries.
    entries: Map<string, EntryView>
    waiting: EntryView[]
}

export const loadBracketView = async (
    prisma: Pick<
        ReadClient,
        | 'tournamentDivision'
        | 'tournamentEntry'
        | 'tournamentMatch'
        | 'organizationClub'
        | 'consentRecord'
        | 'guardianship'
    >,
    organizationId: string,
    tournamentId: string,
    divisionId: string,
): Promise<BracketView> => {
    const division = await loadDivisionView(prisma, tournamentId, divisionId)
    const matches = await prisma.tournamentMatch.findMany({
        where: { divisionId },
        select: MATCH_SELECT,
        orderBy: [{ round: 'asc' }, { position: 'asc' }],
    })
    const entries = await loadEntryViews(prisma, organizationId, { tournamentId, divisionId })
    const byId = new Map(entries.map((e) => [e.id, e]))
    const named = new Set(
        matches.flatMap((m) => [m.entryAId, m.entryBId]).filter((id): id is string => !!id),
    )
    const missing = [...named].filter((id) => !byId.has(id))
    if (missing.length > 0) {
        for (const e of await loadEntryViews(prisma, organizationId, { tournamentId, ids: missing })) {
            byId.set(e.id, e)
        }
    }
    const idAt = new Map(matches.map((m) => [`${m.round}:${m.position}`, m.id]))
    const firstRound = matches.filter((m) => m.round === 1)
    const athletes = division.drawnAt
        ? Math.max(1, firstRound.reduce((n, m) => n + (m.entryAId ? 1 : 0) + (m.entryBId ? 1 : 0), 0))
        : 0
    const size = division.drawnAt ? bracketSize(athletes) : 0
    return {
        division,
        size,
        rounds: roundCount(size),
        matches: matches.map((m) => {
            const next = nextSlot(m.round, m.position)
            return {
                ...m,
                ready: isReady(m),
                nextMatchId: idAt.get(`${next.round}:${next.position}`) ?? null,
            }
        }),
        entries: byId,
        // Before the draw: who waits in the division; a drawn division
        // without matches: its lone athlete («без соперника»).
        waiting: division.drawnAt
            ? matches.length === 0
                ? entries.filter((e) => e.place === 1)
                : []
            : entries.filter((e) => e.status !== 'WITHDRAWN'),
    }
}

// Placed entries per division of a tournament, for «Итоги».
export const loadPodiums = async (
    prisma: Pick<
        ReadClient,
        'tournamentDivision' | 'tournamentEntry' | 'organizationClub' | 'consentRecord' | 'guardianship'
    >,
    organizationId: string,
    tournamentId: string,
): Promise<
    Array<{
        division: { id: string; name: string; drawnAt: Date | null; finishedAt: Date | null }
        podium: EntryView[]
    }>
> => {
    const [divisions, placed] = await Promise.all([
        prisma.tournamentDivision.findMany({
            where: { tournamentId },
            select: { id: true, name: true, drawnAt: true, finishedAt: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.tournamentEntry.findMany({
            where: { tournamentId, place: { not: null } },
            select: { id: true },
        }),
    ])
    const entries = await loadEntryViews(prisma, organizationId, {
        tournamentId,
        ids: placed.map((p) => p.id),
    })
    return divisions.map((d) => ({
        division: d,
        podium: entries
            .filter((e) => e.divisionId === d.id && e.place !== null)
            .sort((a, b) => a.place! - b.place!),
    }))
}

export type LevelRef = { id: string; templateId: string; order: number; name: string }

// Org standard levels by id (an entry's level snapshot → its order).
export const loadLevelRefs = async (
    prisma: Pick<PrismaService, 'organizationLadderTemplateLevel'>,
    organizationId: string,
    ids: Array<string | null>,
): Promise<Map<string, LevelRef>> => {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))]
    if (wanted.length === 0) return new Map()
    const rows = await prisma.organizationLadderTemplateLevel.findMany({
        where: { id: { in: wanted }, template: { organizationId } },
        select: { id: true, templateId: true, order: true, name: true },
    })
    return new Map(rows.map((r) => [r.id, r]))
}

// The divisions' criteria for matching (all of a tournament).
export const loadDivisionCriteria = (
    prisma: Pick<PrismaService, 'tournamentDivision'>,
    tournamentId: string,
) =>
    prisma.tournamentDivision.findMany({
        where: { tournamentId },
        select: DIVISION_SELECT,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
