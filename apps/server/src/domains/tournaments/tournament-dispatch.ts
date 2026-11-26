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
import { plural } from './tournament-errors'
import { matQueue } from './schedule'

// Results news older than this is left alone (as hub announcements).
export const RESULTS_LOOKBACK_MS = 2 * 24 * 60 * 60_000
// Weights are erased this long after publication; places, birth year and sex
// stay (they are the result and explain the division).
export const WEIGHT_RETENTION_MS = 30 * 24 * 60 * 60_000
// Entrants of these queue positions on a mat hear «Скоро ваша схватка».
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

// «Сетки готовы»: every entrant of a drawn division of a RUNNING tournament,
// once per draw.
export const dispatchBracketReady = async (
    prisma: DispatchPrisma,
    notifications: Notifier,
    now: Date,
): Promise<number> => {
    const entries = await prisma.tournamentEntry.findMany({
        where: {
            status: 'CONFIRMED',
            division: { drawnAt: { not: null } },
            tournament: { status: 'RUNNING', organization: { isActive: true } },
        },
        select: ENTRY_PUSH_SELECT,
    })
    const awake = entries.filter((e) => e.division && !isQuietHour(now, e.workspace.timezone))
    const key = (e: (typeof awake)[number]) => `${e.id}:${e.division!.drawNo}`
    const won = await claimDispatchMany(prisma, 'tournament.bracket_ready', awake.map(key))
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
    const won = await claimDispatchMany(
        prisma,
        'tournament.results_published',
        awake.map((e) => e.id),
    )
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

// 30 days after publication the weights go (§2.4).
export const purgeTournamentWeights = async (
    prisma: Pick<PrismaService, 'tournamentEntry'>,
    now: Date,
): Promise<number> =>
    (
        await prisma.tournamentEntry.updateMany({
            where: {
                tournament: {
                    resultsPublishedAt: { lte: new Date(now.getTime() - WEIGHT_RETENTION_MS) },
                },
                OR: [{ declaredWeightG: { not: null } }, { weighedWeightG: { not: null } }],
            },
            data: { declaredWeightG: null, weighedWeightG: null },
        })
    ).count

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

// Right after a result: the entrants of the first matches in the mat's queue
// («Скоро ваша схватка: ковёр 2, перед вами 1 схватка»). Dropped in quiet
// hours; once per (match, entrant).
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
    const queue = matQueue(divisions, matches, p.mat)
        .slice(0, MATCH_SOON_POSITIONS)
    const targets = queue.flatMap((m, ahead) =>
        [m.entryAId, m.entryBId]
            .filter((id): id is string => id !== null)
            .map((entryId) => ({ matchId: m.id, entryId, ahead })),
    )
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
            return {
                userId: e.userId,
                topic: 'Скоро ваша схватка',
                message:
                    t.ahead === 0
                        ? `Ковёр ${p.mat}, ваша схватка следующая`
                        : `Ковёр ${p.mat}, перед вами ${t.ahead} ${plural(t.ahead, 'схватка', 'схватки', 'схваток')}`,
                metadata: meta('tournament.match_soon', e),
            }
        })
    return rows.length === 0 ? 0 : notifications.writeMany(rows)
}
