// Tournament pushes and the weight retention (design
// docs/design/2026-11-27-tournaments.md §6, §2.4). Entrants only (a child's
// push goes to the guardians through writeMany); never club coaches or org
// staff. All three kinds are mutable and respect the quiet hours of the club
// the athlete entered through (22:00–09:00, quiet-hours.ts):
//   - bracket_ready and results_published wait for the first run after 09:00;
//   - match_soon is dropped when quiet (stale news by morning).
// Dispatch claims keep every push once-only across runs and replicas.
import { environment } from '../../environments/environment'
import type { PrismaService } from '../../infrastructure/prisma'
import { isQuietHour } from '../notifications/quiet-hours'
import type {
    NotificationProducerService,
    PushNotificationRow,
} from '../notifications/services/notification-producer.service'
import { claimDispatchMany } from '../scheduler/dispatch-claims'
import { matchesAhead, matQueue } from './schedule'
import { countMatches, tournamentWords } from './tournament-words'

// Results news older than this is left alone (as hub announcements); a
// bracket drawn longer ago than this was announced already.
export const RESULTS_LOOKBACK_MS = 2 * 24 * 60 * 60_000
// Weights are erased this long after publication, or after the event's end
// for a tournament never (or no longer) published; places, birth year and
// sex stay (they are the result and explain the division).
export const WEIGHT_RETENTION_MS = 30 * 24 * 60 * 60_000
// Entrants with fewer matches than this in front on the mat hear «Скоро
// ваша схватка».
export const MATCH_SOON_POSITIONS = 2

type DispatchPrisma = Pick<
    PrismaService,
    'tournamentEntry' | 'tournamentDivision' | 'tournamentMatch' | 'notificationDispatchLog'
>
type Notifier = Pick<NotificationProducerService, 'writeMany'>

const ENTRY_PUSH_SELECT = {
    id: true,
    userId: true,
    workspaceId: true,
    place: true,
    workspace: { select: { timezone: true } },
    division: { select: { name: true, mat: true, drawNo: true } },
    tournament: {
        select: {
            id: true,
            organizationId: true,
            eventId: true,
            event: { select: { title: true } },
            organization: { select: { type: true } },
        },
    },
} as const

const meta = (
    kind: string,
    e: {
        workspaceId: string
        tournament: { id: string; organizationId: string; eventId: string }
    },
) => ({
    kind,
    workspaceId: e.workspaceId,
    organizationId: e.tournament.organizationId,
    eventId: e.tournament.eventId,
    tournamentId: e.tournament.id,
})

// The keys of `refIds` nobody claimed yet: the minute job reads them first so
// it writes only for news (the claim itself still decides once-only across
// replicas).
const unclaimed = async (
    prisma: Pick<PrismaService, 'notificationDispatchLog'>,
    kind: string,
    refIds: string[],
): Promise<string[]> => {
    if (refIds.length === 0) return []
    const taken = await prisma.notificationDispatchLog.findMany({
        where: { kind, refId: { in: refIds } },
        select: { refId: true },
    })
    const done = new Set(taken.map((t) => t.refId))
    return refIds.filter((r) => !done.has(r))
}

// «Сетки готовы»: every entrant in a bracket (confirmed, weighed, in a
// division drawn within the lookback) of a RUNNING tournament, once per draw.
export const dispatchBracketReady = async (
    prisma: DispatchPrisma,
    notifications: Notifier,
    now: Date,
): Promise<number> => {
    const entries = await prisma.tournamentEntry.findMany({
        where: {
            status: 'CONFIRMED',
            weighedWeightG: { not: null },
            division: { drawnAt: { gt: new Date(now.getTime() - RESULTS_LOOKBACK_MS) } },
            tournament: { status: 'RUNNING', organization: { isActive: true } },
        },
        select: ENTRY_PUSH_SELECT,
    })
    const awake = entries.filter((e) => e.division && !isQuietHour(now, e.workspace.timezone))
    const key = (e: (typeof awake)[number]) => `${e.id}:${e.division!.drawNo}`
    const fresh = await unclaimed(prisma, 'tournament.bracket_ready', awake.map(key))
    const won = await claimDispatchMany(prisma, 'tournament.bracket_ready', fresh)
    const rows: PushNotificationRow[] = awake
        .filter((e) => won.has(key(e)))
        .map((e) => ({
            userId: e.userId,
            topic: 'Сетки готовы',
            message: [e.division!.name, e.division!.mat ? `ковёр ${e.division!.mat}` : null]
                .filter(Boolean)
                .join(', '),
            metadata: meta('tournament.bracket_ready', e),
        }))
    return rows.length === 0 ? 0 : notifications.writeMany(rows)
}

// «Итоги «…»: 2 место» / «Итоги опубликованы»: entrants of a tournament
// published within the lookback, once each.
export const dispatchResultsPublished = async (
    prisma: DispatchPrisma,
    notifications: Notifier,
    now: Date,
): Promise<number> => {
    const entries = await prisma.tournamentEntry.findMany({
        where: {
            status: 'CONFIRMED',
            tournament: {
                status: 'FINISHED',
                resultsPublishedAt: {
                    gt: new Date(now.getTime() - RESULTS_LOOKBACK_MS),
                    lte: now,
                },
                organization: { isActive: true },
            },
        },
        select: ENTRY_PUSH_SELECT,
    })
    const awake = entries.filter((e) => !isQuietHour(now, e.workspace.timezone))
    const fresh = await unclaimed(
        prisma,
        'tournament.results_published',
        awake.map((e) => e.id),
    )
    const won = await claimDispatchMany(prisma, 'tournament.results_published', fresh)
    const rows: PushNotificationRow[] = awake
        .filter((e) => won.has(e.id))
        .map((e) => ({
            userId: e.userId,
            topic: `Итоги «${e.tournament.event.title}»`,
            message: e.place ? `${e.place} место` : 'Итоги опубликованы',
            metadata: meta('tournament.results_published', e),
        }))
    return rows.length === 0 ? 0 : notifications.writeMany(rows)
}

// Weights go 30 days after publication, or 30 days after the event ended
// when the results aren't published (abandoned, unpublished): an
// unpublish/republish never restarts the clock past the event's end (§2.4).
export const purgeTournamentWeights = async (
    prisma: Pick<PrismaService, 'tournamentEntry'>,
    now: Date,
): Promise<number> => {
    const before = new Date(now.getTime() - WEIGHT_RETENTION_MS)
    return (
        await prisma.tournamentEntry.updateMany({
            where: {
                AND: [
                    { OR: [{ declaredWeightG: { not: null } }, { weighedWeightG: { not: null } }] },
                    {
                        OR: [
                            { tournament: { resultsPublishedAt: { lte: before } } },
                            { tournament: { event: { endAt: { lte: before } } } },
                            { tournament: { event: { endAt: null, startAt: { lte: before } } } },
                        ],
                    },
                ],
            },
            data: { declaredWeightG: null, weighedWeightG: null },
        })
    ).count
}

// The minute job's part (RemindersService).
export const dispatchTournamentPushes = async (
    prisma: DispatchPrisma,
    notifications: Notifier,
    now: Date,
): Promise<{ bracketReady: number; resultsPublished: number; weightsPurged: number }> => {
    if (!environment.organizations.enabled) {
        return { bracketReady: 0, resultsPublished: 0, weightsPurged: 0 }
    }
    return {
        bracketReady: await dispatchBracketReady(prisma, notifications, now),
        resultsPublished: await dispatchResultsPublished(prisma, notifications, now),
        weightsPurged: await purgeTournamentWeights(prisma, now),
    }
}

// Right after a result: the entrants of ready matches with fewer than
// MATCH_SOON_POSITIONS matches in front on the mat (matchesAhead, the same
// count as «перед вами» on the phone). Dropped in quiet hours; once per
// (match, entrant).
export const notifyMatchSoon = async (
    prisma: DispatchPrisma,
    notifications: Notifier,
    p: { tournamentId: string; mat: number | null; now: Date },
): Promise<number> => {
    if (!environment.organizations.enabled || p.mat === null) return 0
    const [divisions, matches] = await Promise.all([
        prisma.tournamentDivision.findMany({
            where: { tournamentId: p.tournamentId, mat: p.mat },
            select: { id: true, sortOrder: true, mat: true, matOrder: true },
        }),
        prisma.tournamentMatch.findMany({
            where: { tournamentId: p.tournamentId, division: { mat: p.mat } },
            select: {
                id: true,
                divisionId: true,
                round: true,
                position: true,
                entryAId: true,
                entryBId: true,
                isBye: true,
                winnerEntryId: true,
            },
        }),
    ])
    const targets = matQueue(divisions, matches, p.mat).flatMap((m) => {
        const ahead = matchesAhead(divisions, matches, m) ?? Number.MAX_SAFE_INTEGER
        if (ahead >= MATCH_SOON_POSITIONS) return []
        return [m.entryAId, m.entryBId]
            .filter((id): id is string => id !== null)
            .map((entryId) => ({ matchId: m.id, entryId, ahead }))
    })
    if (targets.length === 0) return 0
    const entries = await prisma.tournamentEntry.findMany({
        where: { id: { in: targets.map((t) => t.entryId) } },
        select: ENTRY_PUSH_SELECT,
    })
    const byId = new Map(entries.map((e) => [e.id, e]))
    const awake = targets.filter((t) => {
        const e = byId.get(t.entryId)
        return e && !isQuietHour(p.now, e.workspace.timezone)
    })
    const key = (t: (typeof awake)[number]) => `${t.matchId}:${t.entryId}`
    const won = await claimDispatchMany(prisma, 'tournament.match_soon', awake.map(key))
    const rows: PushNotificationRow[] = awake
        .filter((t) => won.has(key(t)))
        .map((t) => {
            const e = byId.get(t.entryId)!
            const w = tournamentWords(e.tournament.organization.type)
            return {
                userId: e.userId,
                topic: `Скоро ${w.match.your} ${w.match.nom}`,
                message:
                    t.ahead === 0
                        ? `Ковёр ${p.mat}, ${w.match.your} ${w.match.nom} ${w.match.next}`
                        : `Ковёр ${p.mat}, перед вами ${countMatches(t.ahead, w)}`,
                metadata: meta('tournament.match_soon', e),
            }
        })
    return rows.length === 0 ? 0 : notifications.writeMany(rows)
}
