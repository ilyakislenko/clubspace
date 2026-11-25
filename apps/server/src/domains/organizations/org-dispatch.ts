// The federation hub's minute-job fan-outs (design
// docs/design/2026-11-26-federation-hub-mvp.md §3.4), run by RemindersService.
// Both respect each club's quiet hours (22:00–09:00 club-local,
// domains/notifications/quiet-hours.ts): a quiet club is skipped and picked up
// by the first run after 09:00. Per-club / per-registration dispatch claims
// keep every push once-only across runs and replicas.
import { environment } from '../../environments/environment'
import { formatLocalDateTimeRu } from '../../features/attendance/attendance-utils'
import type { PrismaService } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { isQuietHour } from '../notifications/quiet-hours'
import type {
    NotificationProducerService,
    PushNotificationRow,
} from '../notifications/services/notification-producer.service'
import { claimDispatchMany } from '../scheduler/dispatch-claims'

// Older un-notified announcements are left alone (a flag switched on, a
// long outage): a push about last week's news helps nobody.
export const ORG_ANNOUNCEMENT_LOOKBACK_MS = 2 * 24 * 60 * 60_000
// A registered person is reminded once, at the first non-quiet minute within
// a day before the start.
export const ORG_EVENT_REMINDER_AHEAD_MS = 24 * 60 * 60_000

type DispatchPrisma = Pick<
    PrismaService,
    | 'organizationAnnouncement'
    | 'organizationEventRegistration'
    | 'workspaceMember'
    | 'notificationDispatchLog'
>
type Notifier = Pick<NotificationProducerService, 'writeMany' | 'canNotifyUser'>

const excerpt = (body: string): string =>
    body.length > 200 ? `${body.slice(0, 200)}…` : body

// A published org announcement reaches the owner and staff of every ACTIVE
// member club (mutable, category announcementsEnabled; members only read it in
// the feed). `staffNotifiedAt` is stamped once no club is left waiting.
export const dispatchOrgAnnouncementStaffPushes = async (
    prisma: DispatchPrisma,
    notifications: Notifier,
    now: Date,
): Promise<number> => {
    if (!environment.organizations.enabled) return 0
    const due = await prisma.organizationAnnouncement.findMany({
        where: {
            publishedAt: {
                gt: new Date(now.getTime() - ORG_ANNOUNCEMENT_LOOKBACK_MS),
                lte: now,
            },
            staffNotifiedAt: null,
            organization: { isActive: true },
        },
        select: {
            id: true,
            organizationId: true,
            title: true,
            body: true,
            organization: {
                select: {
                    name: true,
                    clubs: {
                        where: { status: 'ACTIVE' },
                        select: {
                            workspaceId: true,
                            workspace: { select: { timezone: true, ownerId: true } },
                        },
                    },
                },
            },
        },
    })
    let count = 0
    for (const a of due) {
        const clubs = a.organization.clubs
        const awake = clubs.filter((c) => !isQuietHour(now, c.workspace.timezone))
        const won = await claimDispatchMany(
            prisma,
            'org.announcement',
            awake.map((c) => `${a.id}:${c.workspaceId}`),
        )
        const wonClubs = awake.filter((c) => won.has(`${a.id}:${c.workspaceId}`))
        if (wonClubs.length > 0) {
            const staff = await prisma.workspaceMember.findMany({
                where: {
                    workspaceId: { in: wonClubs.map((c) => c.workspaceId) },
                    status: 'ACTIVE',
                    role: { name: { in: [...STAFF_ROLES] } },
                },
                select: { userId: true, workspaceId: true },
            })
            // One push per person per announcement, under the first club
            // they staff (an owner without a member row included) — across
            // runs too: someone on the staff of an awake club and of one
            // served after 09:00 holds a per-person claim.
            const recipients = new Map<string, string>()
            for (const c of wonClubs) {
                if (!recipients.has(c.workspace.ownerId)) {
                    recipients.set(c.workspace.ownerId, c.workspaceId)
                }
            }
            for (const m of staff) {
                if (!recipients.has(m.userId)) recipients.set(m.userId, m.workspaceId)
            }
            const eligible: Array<[string, string]> = []
            for (const [userId, workspaceId] of recipients) {
                if (
                    await notifications.canNotifyUser({
                        userId,
                        category: 'announcementsEnabled',
                    })
                ) {
                    eligible.push([userId, workspaceId])
                }
            }
            const firstForPerson = await claimDispatchMany(
                prisma,
                'org.announcement.person',
                eligible.map(([userId]) => `${a.id}:${userId}`),
            )
            const rows: PushNotificationRow[] = eligible
                .filter(([userId]) => firstForPerson.has(`${a.id}:${userId}`))
                .map(([userId, workspaceId]) => ({
                    userId,
                    topic: `Федерация «${a.organization.name}»: ${a.title}`,
                    message: excerpt(a.body),
                    metadata: {
                        kind: 'org.announcement',
                        workspaceId,
                        organizationId: a.organizationId,
                        announcementId: a.id,
                    },
                }))
            await notifications.writeMany(rows)
            count += 1
        }
        // Done once every club holds its claim: the awake ones were just
        // claimed (now or by an earlier run); a quiet one may have been served
        // before its night began.
        const quietKeys = clubs
            .filter((c) => !awake.includes(c))
            .map((c) => `${a.id}:${c.workspaceId}`)
        const done =
            quietKeys.length === 0 ||
            (await prisma.notificationDispatchLog.count({
                where: { kind: 'org.announcement', refId: { in: quietKeys } },
            })) === quietKeys.length
        if (done) {
            await prisma.organizationAnnouncement.update({
                where: { id: a.id },
                data: { staffNotifiedAt: now },
                select: { id: true },
            })
        }
    }
    return count
}

// «Скоро событие федерации» to each booked person (a child's goes to the
// guardians through writeMany), outside the quiet hours of the club they
// registered through.
export const dispatchOrgEventReminders = async (
    prisma: DispatchPrisma,
    notifications: Notifier,
    now: Date,
): Promise<number> => {
    if (!environment.organizations.enabled) return 0
    const regs = await prisma.organizationEventRegistration.findMany({
        where: {
            status: 'BOOKED',
            event: {
                publishedAt: { not: null },
                startAt: {
                    gt: now,
                    lte: new Date(now.getTime() + ORG_EVENT_REMINDER_AHEAD_MS),
                },
                organization: { isActive: true },
            },
        },
        select: {
            id: true,
            userId: true,
            workspaceId: true,
            workspace: { select: { timezone: true } },
            event: {
                select: {
                    id: true,
                    organizationId: true,
                    title: true,
                    startAt: true,
                    timezone: true,
                    place: true,
                },
            },
        },
    })
    const awake = regs.filter((r) => !isQuietHour(now, r.workspace.timezone))
    if (awake.length === 0) return 0
    const won = await claimDispatchMany(
        prisma,
        'org_event.reminder',
        awake.map((r) => r.id),
    )
    const rows: PushNotificationRow[] = awake
        .filter((r) => won.has(r.id))
        .map((r) => ({
            userId: r.userId,
            topic: 'Скоро событие федерации',
            message: [
                r.event.title,
                formatLocalDateTimeRu(r.event.startAt, r.event.timezone),
                r.event.place,
            ]
                .filter(Boolean)
                .join(' · '),
            metadata: {
                kind: 'org_event.reminder',
                workspaceId: r.workspaceId,
                organizationId: r.event.organizationId,
                eventId: r.event.id,
            },
        }))
    if (rows.length === 0) return 0
    return notifications.writeMany(rows)
}
