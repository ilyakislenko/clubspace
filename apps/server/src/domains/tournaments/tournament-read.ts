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
import { consentedPersonIds, TOURNAMENT_CONSENT_MIN_VERSION } from '../organizations/consent'
import { nextMatchFor, type ScheduleDivision, type ScheduleMatch } from './schedule'

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
