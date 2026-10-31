import { Injectable, Logger } from '@nestjs/common'

import {
    isoDayOfWeek,
    localDateInTz,
    localMinuteInTz,
    resolveSlotOccurrence,
} from '../../features/attendance/attendance-utils'
import { announceToWorkspace } from '../../features/manage-announcements/notify'
import { serializeAnnouncement } from '../../features/manage-announcements/schemas'
import {
    MemberStatus,
    Prisma,
    PrismaService,
} from '../../infrastructure/prisma'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import {
    NotificationProducerService,
    type PushNotificationRow,
} from '../notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../realtime/realtime-emitter.service'
import { claimDispatchMany } from './dispatch-claims'

const ANNOUNCEMENT_AUTHOR_SELECT = {
    select: { firstname: true, lastname: true, email: true },
} as const

// Absorb a few missed runs; the dispatch-log check below prevents re-sending.
const ANNOUNCEMENT_GOLIVE_LOOKBACK_MS = 10 * 60_000

// Straddles the 60-min mark by 5 min so clock skew can't drop an
// occurrence; the dispatch ledger keeps it once-only.
const REMINDER_LOOKAHEAD_MIN = 65
const REMINDER_LOOKAHEAD_FLOOR = 55

// Wider than the run interval to absorb a delayed run.
const EXCEPTION_LOOKBACK_MS = 10 * 60_000

const SLOT_SELECT = {
    id: true,
    dayOfWeek: true,
    startTime: true,
    durationMin: true,
    effectiveFrom: true,
    effectiveUntil: true,
    group: {
        select: {
            id: true,
            name: true,
            workspaceId: true,
            workspace: { select: { timezone: true } },
            gym: { select: { timezone: true, name: true } },
        },
    },
} satisfies Prisma.GroupScheduleSlotSelect

type CandidateSlot = Prisma.GroupScheduleSlotGetPayload<{
    select: typeof SLOT_SELECT
}>

type Occurrence = {
    id: string // `${slotId}:${slot-local yyyy-mm-dd}` — the dedupe key
    slot: CandidateSlot
    sessionDate: string
    startAt: Date
}

// A slot runs in its gym's time zone, else its club's.
const slotInTimezone = (tz: string): Prisma.GroupWhereInput => ({
    OR: [
        { gym: { is: { timezone: tz } } },
        {
            workspace: { timezone: tz },
            OR: [{ gymId: null }, { gym: { is: { timezone: null } } }],
        },
    ],
})

/**
 * The minute-sensitive fan-outs: session and event reminders an hour ahead,
 * cancellation notices, scheduled announcements going live. Runs every
 * minute as its own BullMQ job (see scheduler.processors.ts); each pass is
 * idempotent through NotificationDispatchLog claims.
 */
@Injectable()
export class RemindersService {
    private readonly logger = new Logger(RemindersService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async run(now: Date = new Date()): Promise<{
        sessionsNotified: number
        eventsNotified: number
        cancellationsNotified: number
        scheduledAnnouncementsPublished: number
    }> {
        const sessionsNotified = await this.dispatchSessionReminders(now)
        const eventsNotified = await this.dispatchEventReminders(now)
        const cancellationsNotified = await this.dispatchExceptionNotices(now)
        const scheduledAnnouncementsPublished =
            await this.dispatchScheduledAnnouncements(now)
        return {
            sessionsNotified,
            eventsNotified,
            cancellationsNotified,
            scheduledAnnouncementsPublished,
        }
    }

    // A future-dated announcement is published silently by the handler; this
    // fans it out when its time arrives. Skips anything already in the
    // 'announcement.published' log, so immediate publishes aren't re-sent.
    private async dispatchScheduledAnnouncements(now: Date): Promise<number> {
        const since = new Date(now.getTime() - ANNOUNCEMENT_GOLIVE_LOOKBACK_MS)
        const candidates = await this.prisma.announcement.findMany({
            where: { publishedAt: { gt: since, lte: now } },
            include: { author: ANNOUNCEMENT_AUTHOR_SELECT },
        })
        if (candidates.length === 0) return 0

        const alreadySent = new Set(
            (
                await this.prisma.notificationDispatchLog.findMany({
                    where: {
                        kind: 'announcement.published',
                        refId: { in: candidates.map((a) => a.id) },
                    },
                    select: { refId: true },
                })
            ).map((r) => r.refId),
        )

        let count = 0
        for (const a of candidates) {
            if (alreadySent.has(a.id)) continue
            // The claim inside announceToWorkspace fences the next run.
            await announceToWorkspace(this.notifications, a)
            this.realtime.emitListDelta(
                a.workspaceId,
                'announcements',
                'create',
                serializeAnnouncement(a),
            )
            count += 1
        }
        return count
    }

    /**
     * Only slots starting in the reminder window are read: for each time zone
     * in use, the window's minutes are converted to that zone's wall clock
     * (weekday + "HH:MM"), and slots are matched on the indexed
     * (dayOfWeek, startTime) in that zone. The weekday is the slot-local one,
     * so a 21:30 class in New York is found at 00:30 UTC the next UTC day.
     */
    private async dispatchSessionReminders(now: Date): Promise<number> {
        const windowStart = new Date(
            now.getTime() + REMINDER_LOOKAHEAD_FLOOR * 60_000,
        )
        const windowEnd = new Date(
            now.getTime() + REMINDER_LOOKAHEAD_MIN * 60_000,
        )

        const slots = await this.findSlotsStartingIn(windowStart, windowEnd)
        if (slots.length === 0) return 0

        // Slot-local dates the window touches (one, or two across midnight).
        const datesBySlot = new Map<string, string[]>()
        for (const slot of slots) {
            const tz = slot.group.gym?.timezone ?? slot.group.workspace.timezone
            datesBySlot.set(slot.id, [
                ...new Set([
                    localDateInTz(windowStart, tz),
                    localDateInTz(windowEnd, tz),
                ]),
            ])
        }
        const allDates = [...datesBySlot.values()].flat().sort()
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                groupId: { in: [...new Set(slots.map((s) => s.group.id))] },
                fromDate: { lte: new Date(`${allDates[allDates.length - 1]}T00:00:00Z`) },
                untilDate: { gte: new Date(`${allDates[0]}T00:00:00Z`) },
            },
            select: {
                groupId: true,
                slotId: true,
                fromDate: true,
                untilDate: true,
                reason: true,
            },
        })

        const occurrences: Occurrence[] = []
        for (const slot of slots) {
            for (const sessionDate of datesBySlot.get(slot.id) ?? []) {
                const occ = resolveSlotOccurrence({
                    slot,
                    sessionDate,
                    gymTz: slot.group.gym?.timezone ?? null,
                    workspaceTz: slot.group.workspace.timezone,
                    exceptions: exceptions.filter(
                        (e) => e.groupId === slot.group.id,
                    ),
                })
                if (!occ.scheduled || occ.cancelled) continue
                if (occ.startAt < windowStart || occ.startAt > windowEnd) {
                    continue
                }
                occurrences.push({
                    id: `${slot.id}:${sessionDate}`,
                    slot,
                    sessionDate,
                    startAt: occ.startAt,
                })
                break
            }
        }

        const claimed = await claimDispatchMany(
            this.prisma,
            'session.reminder',
            occurrences.map((o) => o.id),
        )
        const due = occurrences.filter((o) => claimed.has(o.id))
        if (due.length === 0) return 0

        // Recipients for every due class in two queries: the groups' coaches
        // and members, plus guests who booked that exact occurrence.
        const [groups, bookings] = await Promise.all([
            this.prisma.group.findMany({
                where: { id: { in: [...new Set(due.map((o) => o.slot.group.id))] } },
                select: {
                    id: true,
                    coaches: { select: { userId: true } },
                    members: { select: { userId: true } },
                },
            }),
            this.prisma.dropInBooking.findMany({
                where: {
                    OR: due.map((o) => ({
                        slotId: o.slot.id,
                        sessionDate: new Date(`${o.sessionDate}T00:00:00Z`),
                    })),
                },
                select: { slotId: true, sessionDate: true, userId: true },
            }),
        ])
        const groupById = new Map(groups.map((g) => [g.id, g]))
        const bookersByOccurrence = new Map<string, string[]>()
        for (const b of bookings) {
            const key = `${b.slotId}:${b.sessionDate.toISOString().slice(0, 10)}`
            const list = bookersByOccurrence.get(key)
            if (list) list.push(b.userId)
            else bookersByOccurrence.set(key, [b.userId])
        }

        const rows: PushNotificationRow[] = []
        for (const o of due) {
            const group = groupById.get(o.slot.group.id)
            const recipients = new Set<string>([
                ...(group?.coaches ?? []).map((c) => c.userId),
                ...(group?.members ?? []).map((m) => m.userId),
                ...(bookersByOccurrence.get(o.id) ?? []),
            ])
            const gym = o.slot.group.gym
            for (const userId of recipients) {
                rows.push({
                    userId,
                    topic: 'Через час тренировка',
                    message: `${o.slot.group.name}${gym ? ` · ${gym.name}` : ''} в ${o.slot.startTime}`,
                    link: null,
                    metadata: {
                        kind: 'session.reminder',
                        workspaceId: o.slot.group.workspaceId,
                        occurrenceId: o.id,
                        groupId: o.slot.group.id,
                        startAt: o.startAt.toISOString(),
                    },
                })
            }
        }
        const written = await this.notifications.writeMany(rows)
        this.logger.log(
            `session reminders: ${due.length} class(es) → ${written} notification(s)`,
        )
        return due.length
    }

    private async findSlotsStartingIn(
        windowStart: Date,
        windowEnd: Date,
    ): Promise<CandidateSlot[]> {
        const [workspaceZones, gymZones] = await Promise.all([
            this.prisma.workspace.findMany({
                distinct: ['timezone'],
                select: { timezone: true },
            }),
            this.prisma.gym.findMany({
                where: { timezone: { not: null } },
                distinct: ['timezone'],
                select: { timezone: true },
            }),
        ])
        const zones = new Set<string>()
        for (const z of [...workspaceZones, ...gymZones]) {
            if (z.timezone) zones.add(z.timezone)
        }

        // Every whole minute in the window, as each zone's wall clock.
        const instants: Date[] = []
        const first = Math.ceil(windowStart.getTime() / 60_000) * 60_000
        for (let t = first; t <= windowEnd.getTime(); t += 60_000) {
            instants.push(new Date(t))
        }

        const clauses: Prisma.GroupScheduleSlotWhereInput[] = []
        for (const tz of zones) {
            const timesByDate = new Map<string, Set<string>>()
            for (const instant of instants) {
                const local = localMinuteInTz(instant, tz)
                const date = local.slice(0, 10)
                const times = timesByDate.get(date) ?? new Set<string>()
                times.add(local.slice(11, 16))
                timesByDate.set(date, times)
            }
            for (const [date, times] of timesByDate) {
                clauses.push({
                    dayOfWeek: isoDayOfWeek(new Date(`${date}T00:00:00Z`)),
                    startTime: { in: [...times] },
                    group: slotInTimezone(tz),
                })
            }
        }
        if (clauses.length === 0) return []

        return this.prisma.groupScheduleSlot.findMany({
            where: { OR: clauses },
            select: SLOT_SELECT,
        })
    }

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
        if (events.length === 0) return 0

        const claimed = await claimDispatchMany(
            this.prisma,
            'event.reminder',
            events.map((e) => e.id),
        )
        const due = events.filter((e) => claimed.has(e.id))
        if (due.length === 0) return 0

        // Workspace-wide: every ACTIVE member (not INVITED/SUSPENDED/BLOCKED).
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: { in: [...new Set(due.map((e) => e.workspaceId))] },
                status: MemberStatus.ACTIVE,
            },
            select: { userId: true, workspaceId: true },
        })

        const rows: PushNotificationRow[] = []
        for (const event of due) {
            for (const m of members) {
                if (m.workspaceId !== event.workspaceId) continue
                rows.push({
                    userId: m.userId,
                    topic: 'Через час событие',
                    message: `${event.title}${event.gym ? ` · ${event.gym.name}` : ''}`,
                    link: event.link ?? null,
                    metadata: {
                        kind: 'event.reminder',
                        workspaceId: event.workspaceId,
                        eventId: event.id,
                        startAt: event.startAt.toISOString(),
                    },
                })
            }
        }
        const written = await this.notifications.writeMany(rows)
        this.logger.log(
            `event reminders: ${due.length} event(s) → ${written} notification(s)`,
        )
        return due.length
    }

    private async dispatchExceptionNotices(now: Date): Promise<number> {
        const since = new Date(now.getTime() - EXCEPTION_LOOKBACK_MS)
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                createdAt: { gte: since },
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
        if (exceptions.length === 0) return 0

        const claimed = await claimDispatchMany(
            this.prisma,
            'exception.notify',
            exceptions.map((e) => e.id),
        )

        let count = 0
        const rows: PushNotificationRow[] = []
        for (const e of exceptions) {
            if (!claimed.has(e.id)) continue

            // fromDate/untilDate are @db.Date calendar days (UTC midnight).
            const sameDay = e.fromDate.getTime() === e.untilDate.getTime()
            const range = sameDay
                ? formatRuDate(e.fromDate, 'UTC')
                : `${formatRuDate(e.fromDate, 'UTC')} — ${formatRuDate(e.untilDate, 'UTC')}`
            const scope = e.slot
                ? `${DAY_SHORT[e.slot.dayOfWeek] ?? e.slot.dayOfWeek} ${e.slot.startTime}`
                : 'вся группа'
            // Guests booked into the cancelled class(es) hear about it too.
            const bookers = await this.prisma.dropInBooking.findMany({
                where: {
                    groupId: e.groupId,
                    ...(e.slotId ? { slotId: e.slotId } : {}),
                    sessionDate: { gte: e.fromDate, lte: e.untilDate },
                },
                select: { userId: true },
            })
            const recipients = new Set<string>([
                ...e.group.coaches.map((c) => c.userId),
                ...e.group.members.map((m) => m.userId),
                ...bookers.map((b) => b.userId),
            ])
            for (const userId of recipients) {
                rows.push({
                    userId,
                    topic: 'Тренировка отменена',
                    message: `${e.group.name}: ${range} (${scope})${
                        e.reason ? ` — ${e.reason}` : ''
                    }`,
                    link: null,
                    metadata: {
                        kind: 'exception.notify',
                        workspaceId: e.group.workspaceId,
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
        await this.notifications.writeMany(rows)
        return count
    }
}

const DAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
