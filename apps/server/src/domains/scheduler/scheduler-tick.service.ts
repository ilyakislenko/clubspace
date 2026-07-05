import { TZDate } from '@date-fns/tz'
import { Injectable, Logger } from '@nestjs/common'

import {
    MemberStatus,
    NotificationTypeEnum,
    PrismaService,
} from '../../infrastructure/prisma'

// Window we look at on each tick: sessions / events whose start falls
// roughly an hour ahead. We straddle the 60-min mark by 5 min on each
// side so even a 1-minute clock skew never lets an occurrence slip
// through the cracks. The dispatch ledger guarantees we still send
// exactly once.
const REMINDER_LOOKAHEAD_MIN = 65
const REMINDER_LOOKAHEAD_FLOOR = 55

// New cancellations are picked up if they appeared within the last
// 2 minutes — wider than the tick interval to absorb a missed beat
// without resending older ones (the dispatch log fences anything older
// that did get sent).
const EXCEPTION_LOOKBACK_MS = 2 * 60_000

// How far ahead we warn a member that their access window is closing. Fires
// once (deduped on member + expiry date) the first tick the member falls
// inside the window.
const ACCESS_EXPIRY_LOOKAHEAD_DAYS = 3

@Injectable()
export class SchedulerTickService {
    private readonly logger = new Logger(SchedulerTickService.name)

    constructor(private readonly prisma: PrismaService) {}

    // Skips going through NotificationsService — that path requires the
    // notifications module's eventsProvider to be wired in our injector
    // tree, which the scheduler module doesn't own. Writing directly to
    // the Notification table is enough: the row is the canonical record,
    // and a separate FCM consumer (when added) will pick it up.
    private async writeNotification(payload: {
        userId: string
        topic: string
        message: string
        link: string | null
        metadata: Record<string, unknown>
    }) {
        await this.prisma.notification.create({
            data: {
                userId: payload.userId,
                type: NotificationTypeEnum.PUSH,
                topic: payload.topic,
                message: payload.message,
                link: payload.link,
                metadata: payload.metadata as never,
                seen: false,
                sent: false,
            },
        })
    }

    async runTick(now: Date = new Date()): Promise<{
        sessionsNotified: number
        eventsNotified: number
        cancellationsNotified: number
        accessExpiryNotified: number
        inactivityNotified: number
    }> {
        const sessionsNotified = await this.dispatchSessionReminders(now)
        const eventsNotified = await this.dispatchEventReminders(now)
        const cancellationsNotified =
            await this.dispatchExceptionNotices(now)
        const accessExpiryNotified =
            await this.dispatchAccessExpiryReminders(now)
        const inactivityNotified = await this.dispatchInactivityNudges(now)
        return {
            sessionsNotified,
            eventsNotified,
            cancellationsNotified,
            accessExpiryNotified,
            inactivityNotified,
        }
    }

    // ---- Inactivity nudges ("we miss you") ------------------------

    // Nudges ACTIVE members (with valid access) whose most recent attendance
    // is older than INACTIVITY_DAYS. Members who have never attended are left
    // alone (that's an onboarding concern, not churn). Deduped weekly so a
    // lapsed member gets at most one nudge per ~week.
    private async dispatchInactivityNudges(now: Date): Promise<number> {
        const INACTIVITY_DAYS = 14
        const DAY_MS = 24 * 60 * 60_000
        const cutoff = new Date(now.getTime() - INACTIVITY_DAYS * DAY_MS)

        const stale = await this.prisma.attendanceRecord.groupBy({
            by: ['workspaceId', 'userId'],
            _max: { markedAt: true },
            having: { markedAt: { _max: { lt: cutoff } } },
        })
        if (stale.length === 0) return 0

        const userIds = [...new Set(stale.map((s) => s.userId))]
        const workspaceIds = [...new Set(stale.map((s) => s.workspaceId))]
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                status: MemberStatus.ACTIVE,
                userId: { in: userIds },
                workspaceId: { in: workspaceIds },
                OR: [{ accessUntil: null }, { accessUntil: { gt: now } }],
            },
            select: {
                userId: true,
                workspaceId: true,
                workspace: { select: { name: true } },
            },
        })
        const memberIndex = new Map(
            members.map((m) => [`${m.workspaceId}:${m.userId}`, m]),
        )

        const weekBucket = Math.floor(now.getTime() / (7 * DAY_MS))
        let count = 0
        for (const s of stale) {
            const key = `${s.workspaceId}:${s.userId}`
            const member = memberIndex.get(key)
            if (!member) continue

            const refId = `${key}:${weekBucket}`
            const dispatched = await this.claimDispatch('member.inactive', refId)
            if (!dispatched) continue

            const lastAt = s._max.markedAt
            await this.writeNotification({
                userId: s.userId,
                topic: 'Давно вас не было',
                message: `${member.workspace.name}: вы не отмечались на тренировках уже больше ${INACTIVITY_DAYS} дней. Ждём вас на мате!`,
                link: null,
                metadata: {
                    kind: 'member.inactive',
                    workspaceId: s.workspaceId,
                    lastAttendedAt: lastAt ? lastAt.toISOString() : null,
                },
            })
            count += 1
        }
        return count
    }

    // ---- Session reminders ----------------------------------------

    private async dispatchSessionReminders(now: Date): Promise<number> {
        const windowStart = new Date(
            now.getTime() + REMINDER_LOOKAHEAD_FLOOR * 60_000,
        )
        const windowEnd = new Date(
            now.getTime() + REMINDER_LOOKAHEAD_MIN * 60_000,
        )

        // Walk every active slot in the system and project the *next*
        // occurrence after `now`. Cheap because slots are workspace-
        // scoped and a single workspace usually has under 50 slots.
        const slots = await this.prisma.groupScheduleSlot.findMany({
            include: {
                group: {
                    include: {
                        workspace: { select: { timezone: true } },
                        gym: { select: { timezone: true, name: true, address: true } },
                        coaches: { select: { userId: true } },
                        members: { select: { userId: true } },
                        exceptions: {
                            // Only need exceptions overlapping the window.
                            where: {
                                fromDate: { lte: windowEnd },
                                untilDate: { gte: windowStart },
                            },
                        },
                    },
                },
            },
        })

        let count = 0
        for (const slot of slots) {
            const tz =
                slot.group.gym?.timezone ??
                slot.group.workspace.timezone

            // Probe today and tomorrow only — the window is 65 minutes
            // wide so a session can land at most one calendar day past
            // `now`. Cheaper than iterating a full week.
            for (const offset of [0, 1]) {
                const probeDate = new Date(now)
                probeDate.setDate(probeDate.getDate() + offset)

                const isoDow = ((probeDate.getDay() + 6) % 7) + 1
                if (isoDow !== slot.dayOfWeek) continue

                const dateStr = `${probeDate.getFullYear()}-${pad(
                    probeDate.getMonth() + 1,
                )}-${pad(probeDate.getDate())}`
                const occurrenceId = `${slot.id}:${dateStr}`

                if (
                    slot.effectiveFrom &&
                    isoDateOnly(probeDate) < isoDateOnly(slot.effectiveFrom)
                ) {
                    continue
                }
                if (
                    slot.effectiveUntil &&
                    isoDateOnly(probeDate) > isoDateOnly(slot.effectiveUntil)
                ) {
                    continue
                }

                const cancelled = slot.group.exceptions.some(
                    (e) =>
                        (e.slotId === null || e.slotId === slot.id) &&
                        isoDateOnly(probeDate) >= isoDateOnly(e.fromDate) &&
                        isoDateOnly(probeDate) <= isoDateOnly(e.untilDate),
                )
                if (cancelled) continue

                const [hour, minute] = slot.startTime
                    .split(':')
                    .map((p) => parseInt(p, 10))
                const startInstant = new Date(
                    new TZDate(
                        probeDate.getFullYear(),
                        probeDate.getMonth(),
                        probeDate.getDate(),
                        hour,
                        minute,
                        tz,
                    ).getTime(),
                )

                if (startInstant < windowStart || startInstant > windowEnd) {
                    continue
                }

                const dispatched = await this.claimDispatch(
                    'session.reminder',
                    occurrenceId,
                )
                if (!dispatched) continue

                const recipients = new Set<string>([
                    ...slot.group.coaches.map((c) => c.userId),
                    ...slot.group.members.map((m) => m.userId),
                ])
                for (const userId of recipients) {
                    await this.writeNotification({
                        userId,
                        topic: 'Через час тренировка',
                        message: `${slot.group.name}${
                            slot.group.gym
                                ? ` · ${slot.group.gym.name}`
                                : ''
                        } в ${slot.startTime}`,
                        link: null,
                        metadata: {
                            kind: 'session.reminder',
                            occurrenceId,
                            groupId: slot.group.id,
                            startAt: startInstant.toISOString(),
                        },
                    })
                }
                count += 1
                this.logger.log(
                    `dispatched session reminder ${occurrenceId} → ${recipients.size} recipients`,
                )
                break // each slot fires at most once per tick
            }
        }
        return count
    }

    // ---- Event reminders ------------------------------------------

    private async dispatchEventReminders(now: Date): Promise<number> {
        const windowStart = new Date(
            now.getTime() + REMINDER_LOOKAHEAD_FLOOR * 60_000,
        )
        const windowEnd = new Date(
            now.getTime() + REMINDER_LOOKAHEAD_MIN * 60_000,
        )
        const events = await this.prisma.workspaceEvent.findMany({
            where: { startAt: { gte: windowStart, lte: windowEnd } },
            include: {
                gym: { select: { name: true, address: true } },
            },
        })

        let count = 0
        for (const event of events) {
            const dispatched = await this.claimDispatch(
                'event.reminder',
                event.id,
            )
            if (!dispatched) continue

            // Workspace-wide: every ACTIVE member (not INVITED/SUSPENDED/BLOCKED).
            const members = await this.prisma.workspaceMember.findMany({
                where: {
                    workspaceId: event.workspaceId,
                    status: MemberStatus.ACTIVE,
                },
                select: { userId: true },
            })
            for (const m of members) {
                await this.writeNotification({
                    userId: m.userId,
                    topic: 'Через час событие',
                    message: `${event.title}${
                        event.gym ? ` · ${event.gym.name}` : ''
                    }`,
                    link: event.link ?? null,
                    metadata: {
                        kind: 'event.reminder',
                        eventId: event.id,
                        startAt: event.startAt.toISOString(),
                    },
                })
            }
            count += 1
            this.logger.log(
                `dispatched event reminder ${event.id} → ${members.length} recipients`,
            )
        }
        return count
    }

    // ---- Cancellation notices -------------------------------------

    private async dispatchExceptionNotices(now: Date): Promise<number> {
        const since = new Date(now.getTime() - EXCEPTION_LOOKBACK_MS)
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                createdAt: { gte: since },
                // Only notify forward-looking cancellations — students
                // don't care about a vacation that already ended.
                untilDate: { gte: now },
            },
            include: {
                group: {
                    include: {
                        coaches: { select: { userId: true } },
                        members: { select: { userId: true } },
                    },
                },
                slot: { select: { startTime: true, dayOfWeek: true } },
            },
        })

        let count = 0
        for (const e of exceptions) {
            const dispatched = await this.claimDispatch(
                'exception.notify',
                e.id,
            )
            if (!dispatched) continue

            const sameDay = isoDateOnly(e.fromDate) === isoDateOnly(e.untilDate)
            const range = sameDay
                ? isoDateOnly(e.fromDate)
                : `${isoDateOnly(e.fromDate)} → ${isoDateOnly(e.untilDate)}`
            const scope = e.slot
                ? `${dayShort(e.slot.dayOfWeek)} ${e.slot.startTime}`
                : 'вся группа'
            const recipients = new Set<string>([
                ...e.group.coaches.map((c) => c.userId),
                ...e.group.members.map((m) => m.userId),
            ])
            for (const userId of recipients) {
                await this.writeNotification({
                    userId,
                    topic: 'Тренировка отменена',
                    message: `${e.group.name}: ${range} (${scope})${
                        e.reason ? ` — ${e.reason}` : ''
                    }`,
                    link: null,
                    metadata: {
                        kind: 'exception.notify',
                        exceptionId: e.id,
                        groupId: e.groupId,
                    },
                })
            }
            count += 1
            this.logger.log(
                `dispatched cancellation ${e.id} → ${recipients.size} recipients`,
            )
        }
        return count
    }

    // ---- Access-window expiry reminders ---------------------------

    private async dispatchAccessExpiryReminders(now: Date): Promise<number> {
        const windowEnd = new Date(
            now.getTime() + ACCESS_EXPIRY_LOOKAHEAD_DAYS * 24 * 60 * 60_000,
        )

        // Members with a manual access window closing within the lookahead
        // (and not already expired). Owners have no member row, so this only
        // ever targets granted members.
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                accessUntil: { gt: now, lte: windowEnd },
                // Only warn approved members — a pending/blocked one losing a
                // window they can't use anyway isn't worth a push.
                status: MemberStatus.ACTIVE,
            },
            select: {
                id: true,
                userId: true,
                accessUntil: true,
                workspace: { select: { name: true } },
            },
        })

        // Respect the per-user opt-out. Absence of a row means the default
        // (enabled), so we only need the users who explicitly turned it off.
        const optedOut = new Set(
            (
                await this.prisma.notificationPreferences.findMany({
                    where: {
                        userId: { in: members.map((m) => m.userId) },
                        accessExpiringEnabled: false,
                    },
                    select: { userId: true },
                })
            ).map((p) => p.userId),
        )

        let count = 0
        for (const member of members) {
            if (!member.accessUntil) continue
            if (optedOut.has(member.userId)) continue

            // Dedup on member + expiry date: a given expiry warns exactly once,
            // but extending access (new accessUntil) re-arms a fresh warning.
            const refId = `${member.id}:${isoDateOnly(member.accessUntil)}`
            const dispatched = await this.claimDispatch(
                'access.expiring',
                refId,
            )
            if (!dispatched) continue

            const daysLeft = Math.max(
                0,
                Math.ceil(
                    (member.accessUntil.getTime() - now.getTime()) /
                        (24 * 60 * 60_000),
                ),
            )
            await this.writeNotification({
                userId: member.userId,
                topic: 'Доступ скоро истекает',
                message: `${member.workspace.name}: доступ истекает ${isoDateOnly(
                    member.accessUntil,
                )}${
                    daysLeft > 0 ? ` (через ${daysLeft} дн.)` : ' (сегодня)'
                }. Продлите, чтобы не потерять доступ к материалам.`,
                link: null,
                metadata: {
                    kind: 'access.expiring',
                    memberId: member.id,
                    accessUntil: member.accessUntil.toISOString(),
                },
            })
            count += 1
            this.logger.log(
                `dispatched access-expiry reminder ${refId} (${daysLeft}d left)`,
            )
        }
        return count
    }

    // ---- Idempotency primitive ------------------------------------

    private async claimDispatch(
        kind: string,
        refId: string,
    ): Promise<boolean> {
        // INSERT-on-conflict-do-nothing: returns affected rows count.
        // Any concurrent worker that loses the race silently gets `0`
        // and skips its fan-out, so the same notification ships once.
        try {
            await this.prisma.notificationDispatchLog.create({
                data: { kind, refId },
            })
            return true
        } catch (err) {
            // P2002 = unique constraint hit — already dispatched.
            if (
                err &&
                typeof err === 'object' &&
                'code' in err &&
                (err as { code: string }).code === 'P2002'
            ) {
                return false
            }
            throw err
        }
    }
}

const pad = (n: number) => String(n).padStart(2, '0')

const isoDateOnly = (d: Date): string =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const DAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const dayShort = (n: number) => DAY_SHORT[n] ?? String(n)
