// «Запись на занятие»: booking, cancelling, the waitlist and the after-class
// sweep for groups in BOOKING mode (docs/design/2026-11-01-class-booking.md).
//
// Concurrency: every write to the bookings of one class first takes the
// ClassOccurrence row lock (SELECT … FOR UPDATE) inside its transaction, so the
// capacity count, the "one live booking per member" rule and waitlist promotion
// are serialized per class across API replicas. Promotion happens inside the
// transaction that frees the spot (or raised the capacity) and in the minutely
// sweep (BullMQ, global concurrency 1) — whichever runs first moves the queue,
// the other finds no free spot. Pushes are deduped on (kind, bookingId).
import { Injectable, Logger } from '@nestjs/common'

import {
    formatLocalDateTimeRu,
    localDateInTz,
    resolveSlotOccurrence,
    scheduledOccurrenceKey,
} from '../../features/attendance/attendance-utils'
import {
    serializeClassRef,
    type ClassBookingOutput,
    type ClassBookingStatusValue,
} from '../../features/class-bookings/schemas'
import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../realtime/realtime-emitter.service'
import {
    addDaysYmd,
    dbDateToYmd,
    ymdToDbDate,
} from '../subscriptions/freeze-dates'
import {
    loadVisitCandidates,
    rankVisitAbonements,
} from '../subscriptions/visit-abonement'
import {
    BOOKING_BLOCK_MESSAGES,
    bookingBlock,
    bookingSettings,
    cancelDeadline,
    effectiveCapacity,
    isLateCancel,
    LIVE_BOOKING_STATUSES,
    waitlistPositions,
} from './class-booking-rules'

type Tx = PrismaTransactionClientType

const LIVE = [...LIVE_BOOKING_STATUSES]
// Rows that matter for the capacity and "already in" checks: a member marked
// present before the class ends still holds their place.
const HOLDING: ClassBookingStatusValue[] = [...LIVE, 'ATTENDED']
const placesTaken = (rows: ReadonlyArray<{ status: string }>): number =>
    rows.filter((b) => b.status === 'BOOKED' || b.status === 'ATTENDED').length

// The sweep settles a class this long after it ended, so a coach marking
// attendance right after class is not raced by a no-show burn.
export const SETTLE_GRACE_MS = 2 * 3_600_000
// Rows per sweep pass; the next minute picks up the rest.
const SWEEP_BATCH = 200

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

const classSelect = {
    id: true,
    dayOfWeek: true,
    startTime: true,
    durationMin: true,
    effectiveFrom: true,
    effectiveUntil: true,
    capacity: true,
    group: {
        select: {
            id: true,
            name: true,
            workspaceId: true,
            directionId: true,
            bookingMode: true,
            capacity: true,
            bookingWindowDays: true,
            bookingCancelHours: true,
            gym: {
                select: { id: true, name: true, address: true, timezone: true },
            },
            coach: { select: { firstname: true, lastname: true, email: true } },
            coaches: { select: { userId: true } },
        },
    },
} as const

const workspaceSelect = {
    timezone: true,
    subscriptionEnabled: true,
    bookingWindowDays: true,
    bookingCancelHours: true,
    bookingLateCancelBurn: true,
    bookingNoShowBurn: true,
} as const

type Booking = {
    id: string
    occurrenceId: string
    userId: string
    status: ClassBookingStatusValue
    bookedById: string | null
    overCapacity: boolean
    promotedAt: Date | null
    cancelledAt: Date | null
    classBurned: boolean
    burnedSubscriptionId: string | null
    createdAt: Date
}

// One dated class of a group with everything the rules need.
export type LoadedClass = Awaited<ReturnType<ClassBookingService['loadClass']>>

type Promoted = { id: string; userId: string }

@Injectable()
export class ClassBookingService {
    private readonly logger = new Logger(ClassBookingService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    // ---- loading -----------------------------------------------------------

    async loadClass(workspaceId: string, slotId: string, sessionDate: string) {
        const slot = await this.prisma.groupScheduleSlot.findFirst({
            where: { id: slotId, group: { workspaceId } },
            select: classSelect,
        })
        if (!slot) throw new NotFoundError({ message: 'Занятие не найдено' })
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: workspaceSelect,
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const date = ymdToDbDate(sessionDate)
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                groupId: slot.group.id,
                fromDate: { lte: date },
                untilDate: { gte: date },
            },
            select: { slotId: true, fromDate: true, untilDate: true, reason: true },
        })
        const occ = resolveSlotOccurrence({
            slot,
            sessionDate,
            gymTz: slot.group.gym?.timezone ?? null,
            workspaceTz: workspace.timezone,
            exceptions,
        })
        const occurrenceKey = scheduledOccurrenceKey(slot.id, sessionDate)
        const occurrence = await this.prisma.classOccurrence.findUnique({
            where: { workspaceId_occurrenceKey: { workspaceId, occurrenceKey } },
            select: { id: true, capacity: true, settledAt: true },
        })
        return {
            workspaceId,
            workspace,
            slot,
            group: slot.group,
            sessionDate,
            date,
            occ,
            occurrenceKey,
            occurrence,
            settings: bookingSettings(workspace, slot.group),
        }
    }

    private ref(cls: LoadedClass) {
        return {
            slotId: cls.slot.id,
            sessionDate: cls.sessionDate,
            groupId: cls.group.id,
            groupName: cls.group.name,
            gym: cls.group.gym,
            coach: cls.group.coach,
            startAt: cls.occ.startAt,
            endAt: cls.occ.endAt,
            timezone: cls.occ.timezone,
            cancelled: !cls.occ.scheduled || cls.occ.cancelled,
        }
    }

    private capacityOf(cls: LoadedClass, occurrenceCapacity: number | null) {
        return effectiveCapacity({
            occurrence: occurrenceCapacity,
            slot: cls.slot.capacity,
            group: cls.group.capacity,
        })
    }

    // The member-facing view of one booking.
    async view(
        cls: LoadedClass,
        b: Booking,
        now: Date = new Date(),
    ): Promise<ClassBookingOutput> {
        let waitlistPosition: number | null = null
        if (b.status === 'WAITLISTED') {
            const queue = await this.prisma.classBooking.findMany({
                where: { occurrenceId: b.occurrenceId, status: 'WAITLISTED' },
                select: { id: true, status: true, createdAt: true },
            })
            waitlistPosition = waitlistPositions(queue).get(b.id) ?? null
        }
        const burnedPlanName = b.burnedSubscriptionId
            ? ((
                  await this.prisma.subscription.findUnique({
                      where: { id: b.burnedSubscriptionId },
                      select: { plan: { select: { name: true } } },
                  })
              )?.plan.name ?? null)
            : null
        return {
            id: b.id,
            status: b.status,
            ...serializeClassRef(this.ref(cls)),
            waitlistPosition,
            cancelDeadline: cancelDeadline(
                cls.occ.startAt,
                cls.settings.cancelHours,
            ).toISOString(),
            lateCancelNow: isLateCancel({
                status: b.status,
                promotedAt: b.promotedAt,
                startAt: cls.occ.startAt,
                cancelHours: cls.settings.cancelHours,
                now,
            }),
            lateCancelBurns: cls.settings.lateCancelBurn,
            noShowBurns: cls.settings.noShowBurn,
            promotedAt: b.promotedAt?.toISOString() ?? null,
            cancelledAt: b.cancelledAt?.toISOString() ?? null,
            overCapacity: b.overCapacity,
            classBurned: b.classBurned,
            burnedPlanName,
            createdAt: b.createdAt.toISOString(),
        }
    }

    // ---- locking -----------------------------------------------------------

    private async ensureOccurrence(cls: LoadedClass): Promise<{ id: string }> {
        if (cls.occurrence) return cls.occurrence
        try {
            return await this.prisma.classOccurrence.create({
                data: {
                    workspaceId: cls.workspaceId,
                    groupId: cls.group.id,
                    slotId: cls.slot.id,
                    sessionDate: cls.date,
                    occurrenceKey: cls.occurrenceKey,
                    startAt: cls.occ.startAt,
                    endAt: cls.occ.endAt,
                },
                select: { id: true },
            })
        } catch (e) {
            if (!isP2002(e)) throw e
            return this.prisma.classOccurrence.findUniqueOrThrow({
                where: {
                    workspaceId_occurrenceKey: {
                        workspaceId: cls.workspaceId,
                        occurrenceKey: cls.occurrenceKey,
                    },
                },
                select: { id: true },
            })
        }
    }

    // Takes the class's row lock for the rest of the transaction and returns
    // the row as it is now (capacity / settledAt may have changed meanwhile).
    // Also keeps the stored start/end in step with the slot.
    private async lock(tx: Tx, occurrenceId: string, cls: LoadedClass) {
        const [row] = await tx.$queryRaw<
            Array<{
                capacity: number | null
                settledAt: Date | null
                startAt: Date
                endAt: Date
            }>
        >`SELECT "capacity", "settledAt", "startAt", "endAt" FROM "ClassOccurrence" WHERE "id" = ${occurrenceId}::uuid FOR UPDATE`
        if (!row) throw new NotFoundError({ message: 'Занятие не найдено' })
        if (
            row.startAt.getTime() !== cls.occ.startAt.getTime() ||
            row.endAt.getTime() !== cls.occ.endAt.getTime()
        ) {
            await tx.classOccurrence.update({
                where: { id: occurrenceId },
                data: { startAt: cls.occ.startAt, endAt: cls.occ.endAt },
            })
        }
        return row
    }

    // ---- member actions ----------------------------------------------------

    private assertOpenForBooking(cls: LoadedClass, now: Date) {
        if (cls.group.bookingMode !== 'BOOKING') {
            throw new BadRequestError({
                message: 'Эта группа занимается постоянным составом — запись на занятие не нужна',
            })
        }
        if (!cls.occ.scheduled) {
            throw new BadRequestError({
                message: 'В эту дату занятия по расписанию нет',
            })
        }
        if (cls.occ.cancelled) {
            throw new BadRequestError({ message: 'Это занятие отменено' })
        }
        if (cls.occ.startAt.getTime() <= now.getTime()) {
            throw new BadRequestError({
                message: 'Запись закрыта — занятие уже началось',
            })
        }
        const opensOn = addDaysYmd(cls.sessionDate, -cls.settings.windowDays)
        if (localDateInTz(now, cls.occ.timezone) < opensOn) {
            throw new BadRequestError({
                message: `Запись на это занятие откроется ${formatRuDate(ymdToDbDate(opensOn), 'UTC')}`,
            })
        }
    }

    private async assertActiveMember(workspaceId: string, userId: string) {
        // The owner has no member row: refused like any non-member.
        const member = await this.prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId } },
            select: { status: true },
        })
        if (!member) {
            throw new ForbiddenError({
                message: 'Запись на занятия доступна участникам клуба',
            })
        }
        if (member.status !== 'ACTIVE') {
            throw new ForbiddenError({
                message: 'Ваше участие в клубе приостановлено — обратитесь к тренеру',
            })
        }
    }

    // Why this member may not hold a place in this class (null = may), by the
    // visit precedence's eligibility plus the class-pack allocation rule.
    private async abonementBlock(
        cls: LoadedClass,
        userId: string,
        now: Date,
    ): Promise<string | null> {
        const dayYmd = localDateInTz(cls.occ.startAt, cls.workspace.timezone)
        const candidates =
            (
                await loadVisitCandidates(this.prisma, {
                    workspaceId: cls.workspaceId,
                    userIds: [userId],
                    dayYmd,
                    now,
                })
            ).get(userId) ?? []
        // Other classes the member holds (or waits for) a place in: class
        // bookings and drop-ins that haven't started.
        const held = await this.prisma.classBooking.findMany({
            where: {
                workspaceId: cls.workspaceId,
                userId,
                status: { in: LIVE },
                occurrence: {
                    startAt: { gt: now },
                    NOT: { occurrenceKey: cls.occurrenceKey },
                },
            },
            select: { occurrence: { select: { group: { select: { directionId: true } } } } },
        })
        const dropIns = await this.prisma.dropInBooking.findMany({
            where: {
                workspaceId: cls.workspaceId,
                userId,
                sessionDate: {
                    gte: ymdToDbDate(localDateInTz(now, cls.workspace.timezone)),
                },
            },
            select: { group: { select: { directionId: true } } },
        })
        const block = bookingBlock({
            abonements: candidates,
            classDirectionId: cls.group.directionId,
            startAt: cls.occ.startAt,
            heldDirections: [
                ...held.map((h) => h.occurrence.group.directionId),
                ...dropIns.map((d) => d.group.directionId),
            ],
        })
        return block ? BOOKING_BLOCK_MESSAGES[block] : null
    }

    // Books a place (or a waitlist place when full) for `userId`. Re-sending
    // returns the booking the member already holds.
    async book(p: {
        workspaceId: string
        userId: string
        actorId: string
        slotId: string
        sessionDate: string
        now?: Date
    }): Promise<ClassBookingOutput> {
        const now = p.now ?? new Date()
        const cls = await this.loadClass(p.workspaceId, p.slotId, p.sessionDate)
        this.assertOpenForBooking(cls, now)
        if (cls.group.coaches.some((c) => c.userId === p.userId)) {
            throw new BadRequestError({ message: 'Вы тренер этой группы' })
        }
        await this.assertActiveMember(p.workspaceId, p.userId)

        if (cls.occurrence) {
            const held = await this.prisma.classBooking.findFirst({
                where: {
                    occurrenceId: cls.occurrence.id,
                    userId: p.userId,
                    status: { in: HOLDING },
                },
            })
            if (held) return this.view(cls, held, now)
        }
        if (cls.workspace.subscriptionEnabled) {
            const blocked = await this.abonementBlock(cls, p.userId, now)
            if (blocked) throw new BadRequestError({ message: blocked })
        }

        const occurrence = await this.ensureOccurrence(cls)
        const booking = await this.prisma.$transaction(async (tx) => {
            const row = await this.lock(tx, occurrence.id, cls)
            const live = await tx.classBooking.findMany({
                where: { occurrenceId: occurrence.id, status: { in: HOLDING } },
            })
            const mine = live.find((b) => b.userId === p.userId)
            if (mine) return mine
            const capacity = this.capacityOf(cls, row.capacity)
            const booked = placesTaken(live)
            return tx.classBooking.create({
                data: {
                    workspaceId: p.workspaceId,
                    occurrenceId: occurrence.id,
                    userId: p.userId,
                    status:
                        capacity === null || booked < capacity
                            ? 'BOOKED'
                            : 'WAITLISTED',
                    bookedById: p.actorId,
                },
            })
        })
        this.invalidate(p.workspaceId, [p.userId])
        return this.view(cls, booking, now)
    }

    // The member gives up their place (or waitlist place). A held place given
    // up after the deadline is a late cancel and burns a class when the club
    // burns; the freed spot goes to the waitlist at once.
    async cancelOwn(p: {
        workspaceId: string
        userId: string
        bookingId: string
        now?: Date
    }): Promise<ClassBookingOutput> {
        const now = p.now ?? new Date()
        const booking = await this.prisma.classBooking.findFirst({
            where: { id: p.bookingId, workspaceId: p.workspaceId, userId: p.userId },
            include: { occurrence: { select: { slotId: true, sessionDate: true } } },
        })
        if (!booking) throw new NotFoundError({ message: 'Запись не найдена' })
        const cls = await this.loadClass(
            p.workspaceId,
            booking.occurrence.slotId,
            dbDateToYmd(booking.occurrence.sessionDate),
        )
        if (!LIVE.includes(booking.status as (typeof LIVE)[number])) {
            return this.view(cls, booking, now)
        }
        const running = cls.occ.scheduled && !cls.occ.cancelled
        if (running && cls.occ.startAt.getTime() <= now.getTime()) {
            throw new BadRequestError({
                message: 'Занятие уже началось — отменить запись нельзя',
            })
        }
        const late =
            running &&
            isLateCancel({
                status: booking.status,
                promotedAt: booking.promotedAt,
                startAt: cls.occ.startAt,
                cancelHours: cls.settings.cancelHours,
                now,
            })
        const result = await this.release(cls, booking.occurrenceId, booking.id, {
            status: late ? 'LATE_CANCELLED' : 'CANCELLED',
            burn: late && cls.settings.lateCancelBurn,
            now,
        })
        return this.view(cls, result, now)
    }

    // Frees a live booking under the class lock: sets its final status, burns a
    // class when asked, then hands freed spots to the waitlist.
    private async release(
        cls: LoadedClass,
        occurrenceId: string,
        bookingId: string,
        p: { status: ClassBookingStatusValue; burn: boolean; now: Date },
    ): Promise<Booking> {
        const { booking, promoted, burned } = await this.prisma.$transaction(
            async (tx) => {
                const row = await this.lock(tx, occurrenceId, cls)
                const current = await tx.classBooking.findUniqueOrThrow({
                    where: { id: bookingId },
                })
                if (!LIVE.includes(current.status as (typeof LIVE)[number])) {
                    return { booking: current, promoted: [], burned: false }
                }
                const burnedId = p.burn
                    ? await this.burnClass(tx, cls, current.userId)
                    : null
                const updated = await tx.classBooking.update({
                    where: { id: bookingId },
                    data: {
                        status: p.status,
                        cancelledAt: p.now,
                        classBurned: burnedId !== null,
                        burnedSubscriptionId: burnedId,
                    },
                })
                const promoted =
                    current.status === 'BOOKED'
                        ? await this.promoteInTx(tx, cls, occurrenceId, row.capacity, p.now)
                        : []
                return { booking: updated, promoted, burned: burnedId !== null }
            },
        )
        this.invalidate(cls.workspaceId, [
            booking.userId,
            ...promoted.map((b) => b.userId),
        ], burned ? [booking.userId] : [])
        await this.notifyPromoted(cls, promoted)
        return booking
    }

    // Takes one class from the abonement a visit to this class would be spent
    // on (the visit precedence's first). A time-based abonement, or none, burns
    // nothing. Returns the pack it was taken from.
    private async burnClass(
        tx: Tx,
        cls: LoadedClass,
        userId: string,
    ): Promise<string | null> {
        const at = cls.occ.startAt
        const candidates =
            (
                await loadVisitCandidates(tx, {
                    workspaceId: cls.workspaceId,
                    userIds: [userId],
                    dayYmd: localDateInTz(at, cls.workspace.timezone),
                    now: at,
                })
            ).get(userId) ?? []
        const used = rankVisitAbonements(candidates, {
            sessionDirectionId: cls.group.directionId,
            now: at,
        })[0]
        if (!used || used.classesTotal === null) return null
        const taken = await tx.subscription.updateMany({
            where: { id: used.id, classesRemaining: { gt: 0 } },
            data: { classesRemaining: { decrement: 1 } },
        })
        return taken.count === 1 ? used.id : null
    }

    // Moves waitlisted bookings into free spots, oldest first. Caller holds
    // the class lock. Promotions close when the class starts.
    private async promoteInTx(
        tx: Tx,
        cls: LoadedClass,
        occurrenceId: string,
        occurrenceCapacity: number | null,
        now: Date,
    ): Promise<Promoted[]> {
        if (
            !cls.occ.scheduled ||
            cls.occ.cancelled ||
            cls.occ.startAt.getTime() <= now.getTime()
        ) {
            return []
        }
        const capacity = this.capacityOf(cls, occurrenceCapacity)
        const live = await tx.classBooking.findMany({
            where: { occurrenceId, status: { in: HOLDING } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, userId: true, status: true },
        })
        let free =
            capacity === null
                ? Number.POSITIVE_INFINITY
                : capacity - placesTaken(live)
        const promoted: Promoted[] = []
        for (const b of live) {
            if (free <= 0) break
            if (b.status !== 'WAITLISTED') continue
            const moved = await tx.classBooking.updateMany({
                where: { id: b.id, status: 'WAITLISTED' },
                data: { status: 'BOOKED', promotedAt: now },
            })
            if (moved.count === 1) {
                promoted.push({ id: b.id, userId: b.userId })
                free -= 1
            }
        }
        return promoted
    }

    private async notifyPromoted(cls: LoadedClass, promoted: Promoted[]) {
        const when = formatLocalDateTimeRu(cls.occ.startAt, cls.occ.timezone)
        for (const b of promoted) {
            await this.push({
                userId: b.userId,
                kind: 'classbooking.promoted',
                bookingId: b.id,
                cls,
                topic: 'Освободилось место',
                message: `Вы записаны на «${cls.group.name}» ${when}. Не сможете прийти — отмените запись в приложении`,
            })
        }
    }

    // Best-effort push, deduped on (kind, bookingId): the write is committed,
    // a failed push must not undo it, and a retried run never pushes twice.
    private async push(p: {
        userId: string
        kind: string
        bookingId: string
        cls: LoadedClass
        topic: string
        message: string
    }) {
        try {
            await this.notifications.notifyUser({
                userId: p.userId,
                kind: p.kind,
                refId: p.bookingId,
                topic: p.topic,
                message: p.message,
                metadata: {
                    bookingId: p.bookingId,
                    groupId: p.cls.group.id,
                    slotId: p.cls.slot.id,
                    sessionDate: p.cls.sessionDate,
                },
                workspaceId: p.cls.workspaceId,
            })
        } catch (err) {
            this.logger.warn(
                `Class booking push ${p.kind} failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }
    }

    private invalidate(
        workspaceId: string,
        userIds: string[],
        abonementChanged: string[] = [],
    ) {
        this.realtime.invalidate(workspaceId, ['schedule', 'attendance', 'classbookings'])
        this.realtime.invalidateUsersInWorkspace(
            [...new Set(userIds)],
            workspaceId,
            ['classbookings', 'schedule'],
        )
        if (abonementChanged.length > 0) {
            this.realtime.invalidateUsersInWorkspace(
                abonementChanged,
                workspaceId,
                ['subscription'],
            )
        }
    }

    // ---- staff actions -----------------------------------------------------

    // Staff put a member into the class, over the capacity if it is full (a
    // waitlisted member is moved to a place). No abonement check: staff decide,
    // the visit is charged when the member is marked present.
    async addByStaff(p: {
        cls: LoadedClass
        userId: string
        actorId: string
        now?: Date
    }): Promise<void> {
        const now = p.now ?? new Date()
        const { cls } = p
        if (cls.group.bookingMode !== 'BOOKING') {
            throw new BadRequestError({
                message: 'Эта группа занимается постоянным составом — запись на занятие не нужна',
            })
        }
        if (!cls.occ.scheduled || cls.occ.cancelled) {
            throw new BadRequestError({ message: 'Это занятие отменено' })
        }
        if (cls.occ.endAt.getTime() <= now.getTime()) {
            throw new BadRequestError({ message: 'Занятие уже закончилось' })
        }
        const member = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId: p.userId, workspaceId: cls.workspaceId },
            },
            select: { status: true },
        })
        if (!member || member.status !== 'ACTIVE') {
            throw new BadRequestError({ message: 'Ученик не состоит в клубе' })
        }
        const occurrence = await this.ensureOccurrence(cls)
        const { booking, added } = await this.prisma.$transaction(async (tx) => {
            const row = await this.lock(tx, occurrence.id, cls)
            const live = await tx.classBooking.findMany({
                where: { occurrenceId: occurrence.id, status: { in: HOLDING } },
            })
            const capacity = this.capacityOf(cls, row.capacity)
            const full =
                capacity !== null &&
                placesTaken(live) >= capacity
            const mine = live.find((b) => b.userId === p.userId)
            if (mine && mine.status !== 'WAITLISTED') {
                return { booking: mine, added: false }
            }
            if (mine) {
                const moved = await tx.classBooking.update({
                    where: { id: mine.id },
                    data: { status: 'BOOKED', promotedAt: now, overCapacity: full },
                })
                return { booking: moved, added: true }
            }
            const created = await tx.classBooking.create({
                data: {
                    workspaceId: cls.workspaceId,
                    occurrenceId: occurrence.id,
                    userId: p.userId,
                    status: 'BOOKED',
                    bookedById: p.actorId,
                    overCapacity: full,
                },
            })
            return { booking: created, added: true }
        })
        if (!added) return
        this.invalidate(cls.workspaceId, [p.userId])
        const when = formatLocalDateTimeRu(cls.occ.startAt, cls.occ.timezone)
        await this.push({
            userId: p.userId,
            kind: 'classbooking.added',
            bookingId: booking.id,
            cls,
            topic: 'Вас записали на занятие',
            message: `«${cls.group.name}» ${when}`,
        })
    }

    // Staff take a member off the class: no late-cancel burn.
    async removeByStaff(p: {
        cls: LoadedClass
        bookingId: string
        now?: Date
    }): Promise<void> {
        const now = p.now ?? new Date()
        const booking = await this.prisma.classBooking.findFirst({
            where: {
                id: p.bookingId,
                workspaceId: p.cls.workspaceId,
                occurrence: { occurrenceKey: p.cls.occurrenceKey },
            },
            select: { id: true, occurrenceId: true, status: true, userId: true },
        })
        if (!booking) throw new NotFoundError({ message: 'Запись не найдена' })
        if (!LIVE.includes(booking.status as (typeof LIVE)[number])) return
        await this.release(p.cls, booking.occurrenceId, booking.id, {
            status: 'CANCELLED',
            burn: false,
            now,
        })
    }

    // Sets (or clears, null) the capacity of this one date; a raise promotes
    // from the waitlist at once.
    async setOccurrenceCapacity(p: {
        cls: LoadedClass
        capacity: number | null
        now?: Date
    }): Promise<void> {
        const now = p.now ?? new Date()
        const { cls } = p
        if (cls.group.bookingMode !== 'BOOKING') {
            throw new BadRequestError({
                message: 'Места задаются только в группах с записью на занятие',
            })
        }
        const occurrence = await this.ensureOccurrence(cls)
        const promoted = await this.prisma.$transaction(async (tx) => {
            await this.lock(tx, occurrence.id, cls)
            await tx.classOccurrence.update({
                where: { id: occurrence.id },
                data: { capacity: p.capacity },
            })
            return this.promoteInTx(tx, cls, occurrence.id, p.capacity, now)
        })
        this.invalidate(cls.workspaceId, promoted.map((b) => b.userId))
        await this.notifyPromoted(cls, promoted)
    }

    // ---- club-side cancellations -------------------------------------------

    // The club cancelled classes (a schedule exception, or the group left
    // BOOKING mode): every live booking of the not-yet-settled classes in scope
    // is closed as CANCELLED_BY_CLUB — nothing is burned — and its member hears
    // about it.
    async cancelByClub(p: {
        workspaceId: string
        groupId: string
        slotId?: string | null
        fromDate?: Date
        untilDate?: Date
        startsAfter?: Date
        reason: string | null
        now?: Date
    }): Promise<number> {
        const now = p.now ?? new Date()
        const occurrences = await this.prisma.classOccurrence.findMany({
            where: {
                workspaceId: p.workspaceId,
                groupId: p.groupId,
                settledAt: null,
                ...(p.slotId ? { slotId: p.slotId } : {}),
                ...(p.fromDate || p.untilDate
                    ? { sessionDate: { gte: p.fromDate, lte: p.untilDate } }
                    : {}),
                ...(p.startsAfter ? { startAt: { gt: p.startsAfter } } : {}),
                bookings: { some: { status: { in: LIVE } } },
            },
            select: { id: true, slotId: true, sessionDate: true },
        })
        let cancelled = 0
        for (const o of occurrences) {
            const cls = await this.loadClass(
                p.workspaceId,
                o.slotId,
                dbDateToYmd(o.sessionDate),
            )
            const closed = await this.prisma.$transaction(async (tx) => {
                await this.lock(tx, o.id, cls)
                const live = await tx.classBooking.findMany({
                    where: { occurrenceId: o.id, status: { in: LIVE } },
                    select: { id: true, userId: true },
                })
                await tx.classBooking.updateMany({
                    where: { id: { in: live.map((b) => b.id) } },
                    data: { status: 'CANCELLED_BY_CLUB', cancelledAt: now },
                })
                return live
            })
            cancelled += closed.length
            this.invalidate(p.workspaceId, closed.map((b) => b.userId))
            const when = formatLocalDateTimeRu(cls.occ.startAt, cls.occ.timezone)
            for (const b of closed) {
                await this.push({
                    userId: b.userId,
                    kind: 'classbooking.club_cancelled',
                    bookingId: b.id,
                    cls,
                    topic: 'Занятие отменено',
                    message: `«${cls.group.name}» ${when} не состоится${
                        p.reason ? ` — ${p.reason}` : ''
                    }. Занятие с абонемента не списано`,
                })
            }
        }
        return cancelled
    }

    // ---- the sweep (scheduler, every minute) --------------------------------

    async sweep(now: Date): Promise<{ promoted: number; settled: number }> {
        let promoted = 0
        // Spots freed outside a booking transaction (a capacity raised on the
        // group or slot, a member who left the club) reach the waitlist here.
        const waiting = await this.prisma.classOccurrence.findMany({
            where: {
                startAt: { gt: now },
                settledAt: null,
                bookings: { some: { status: 'WAITLISTED' } },
            },
            orderBy: { startAt: 'asc' },
            take: SWEEP_BATCH,
            select: { id: true, workspaceId: true, slotId: true, sessionDate: true },
        })
        for (const o of waiting) {
            try {
                const cls = await this.loadClass(
                    o.workspaceId,
                    o.slotId,
                    dbDateToYmd(o.sessionDate),
                )
                const moved = await this.prisma.$transaction(async (tx) => {
                    const row = await this.lock(tx, o.id, cls)
                    return this.promoteInTx(tx, cls, o.id, row.capacity, now)
                })
                if (moved.length > 0) {
                    promoted += moved.length
                    this.invalidate(o.workspaceId, moved.map((b) => b.userId))
                    await this.notifyPromoted(cls, moved)
                }
            } catch (err) {
                this.logger.error(
                    `promotion of class ${o.id} failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }

        let settled = 0
        const due = await this.prisma.classOccurrence.findMany({
            where: {
                settledAt: null,
                endAt: { lte: new Date(now.getTime() - SETTLE_GRACE_MS) },
            },
            orderBy: { endAt: 'asc' },
            take: SWEEP_BATCH,
            select: { id: true, workspaceId: true, slotId: true, sessionDate: true },
        })
        for (const o of due) {
            try {
                if (await this.settle(o, now)) settled += 1
            } catch (err) {
                this.logger.error(
                    `settling class ${o.id} failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }
        return { promoted, settled }
    }

    // Closes a finished class: marked members → ATTENDED, booked but unmarked →
    // NO_SHOW (burning a class when the club burns), still waitlisted → EXPIRED;
    // a class the club cancelled → CANCELLED_BY_CLUB, nothing burned.
    private async settle(
        o: { id: string; workspaceId: string; slotId: string; sessionDate: Date },
        now: Date,
    ): Promise<boolean> {
        const cls = await this.loadClass(
            o.workspaceId,
            o.slotId,
            dbDateToYmd(o.sessionDate),
        )
        const off = !cls.occ.scheduled || cls.occ.cancelled
        if (!off && cls.occ.endAt.getTime() > now.getTime() - SETTLE_GRACE_MS) {
            // The slot moved later; the stored end is refreshed by the lock.
            await this.prisma.$transaction((tx) => this.lock(tx, o.id, cls))
            return false
        }
        const burned = await this.prisma.$transaction(async (tx) => {
            const row = await this.lock(tx, o.id, cls)
            if (row.settledAt) return null
            const live = await tx.classBooking.findMany({
                where: { occurrenceId: o.id, status: { in: LIVE } },
                select: { id: true, userId: true, status: true },
            })
            const burned: Array<{ id: string; userId: string; subscriptionId: string }> = []
            if (off) {
                await tx.classBooking.updateMany({
                    where: { id: { in: live.map((b) => b.id) } },
                    data: { status: 'CANCELLED_BY_CLUB', cancelledAt: now },
                })
            } else {
                const session = await tx.attendanceSession.findUnique({
                    where: {
                        workspaceId_occurrenceKey: {
                            workspaceId: o.workspaceId,
                            occurrenceKey: cls.occurrenceKey,
                        },
                    },
                    select: { records: { select: { userId: true } } },
                })
                const present = new Set(session?.records.map((r) => r.userId) ?? [])
                const attended = live.filter((b) => present.has(b.userId))
                const expired = live.filter(
                    (b) => !present.has(b.userId) && b.status === 'WAITLISTED',
                )
                const noShows = live.filter(
                    (b) => !present.has(b.userId) && b.status === 'BOOKED',
                )
                await tx.classBooking.updateMany({
                    where: { id: { in: attended.map((b) => b.id) } },
                    data: { status: 'ATTENDED' },
                })
                await tx.classBooking.updateMany({
                    where: { id: { in: expired.map((b) => b.id) } },
                    data: { status: 'EXPIRED' },
                })
                for (const b of noShows) {
                    const burnedId = cls.settings.noShowBurn
                        ? await this.burnClass(tx, cls, b.userId)
                        : null
                    await tx.classBooking.update({
                        where: { id: b.id },
                        data: {
                            status: 'NO_SHOW',
                            classBurned: burnedId !== null,
                            burnedSubscriptionId: burnedId,
                        },
                    })
                    if (burnedId) {
                        burned.push({ id: b.id, userId: b.userId, subscriptionId: burnedId })
                    }
                }
            }
            await tx.classOccurrence.update({
                where: { id: o.id },
                data: { settledAt: now },
            })
            return { live, burned }
        })
        if (!burned) return false
        this.invalidate(
            o.workspaceId,
            burned.live.map((b) => b.userId),
            burned.burned.map((b) => b.userId),
        )
        const when = formatLocalDateTimeRu(cls.occ.startAt, cls.occ.timezone)
        for (const b of burned.burned) {
            await this.push({
                userId: b.userId,
                kind: 'classbooking.noshow',
                bookingId: b.id,
                cls,
                topic: 'Пропуск занятия',
                message: `Вы были записаны на «${cls.group.name}» ${when}, но не пришли — занятие списано с абонемента`,
            })
        }
        return true
    }
}
