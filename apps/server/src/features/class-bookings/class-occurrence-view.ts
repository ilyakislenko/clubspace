import {
    cancelDeadline,
    effectiveCapacity,
    waitlistPositions,
} from '../../domains/class-bookings/class-booking-rules'
import {
    ClassBookingService,
    type LoadedClass,
} from '../../domains/class-bookings/class-booking.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import {
    ClassOccurrenceParamsSchema,
    type ClassOccurrenceParams,
} from './get-class-occurrence.feature'
import {
    serializeClassRef,
    type ClassBookingStatusValue,
    type ClassOccurrenceOutput,
} from './schemas'

// Roster order: places first (booked / attended), then the waitlist in queue
// order, then what happened to the rest.
const STATUS_ORDER: Record<ClassBookingStatusValue, number> = {
    BOOKED: 0,
    ATTENDED: 0,
    WAITLISTED: 1,
    NO_SHOW: 2,
    LATE_CANCELLED: 3,
    CANCELLED: 4,
    CANCELLED_BY_CLUB: 5,
    EXPIRED: 6,
}

// Statuses that held a place in the class.
const HELD_PLACE: ReadonlySet<ClassBookingStatusValue> = new Set([
    'BOOKED',
    'ATTENDED',
    'NO_SHOW',
])

// Staff access to one class: loads it and checks the caller may see it (read)
// or change it (write) — coaches of the group, its direction's managers and
// admins; a coach in a «coach sees all groups» club may also read.
export const loadClassForStaff = async (
    rbac: RbacService,
    classBookings: ClassBookingService,
    f: {
        params: ClassOccurrenceParams
        workspaceId: string
        invokerUserId: string
        roleName: string | null
        isSuperAdmin: boolean
    },
    access: 'read' | 'write',
): Promise<LoadedClass> => {
    const ctx = await rbac.resolveCoachScope({
        userId: f.invokerUserId,
        workspaceId: f.workspaceId,
        roleName: f.roleName,
        isSuperAdmin: f.isSuperAdmin,
    })
    // Path params: the date is validated here (no DTO on a path segment).
    if (!ClassOccurrenceParamsSchema.safeParse(f.params).success) {
        throw new BadRequestError({ message: 'Неверная дата занятия' })
    }
    const cls = await classBookings.loadClass(
        f.workspaceId,
        f.params.slotId,
        f.params.sessionDate,
    )
    if (access === 'write' || !rbac.canSeeAllGroups(ctx)) {
        await rbac.assertCanWriteGroup(ctx, cls.group.id)
    }
    return cls
}

// The staff roster of one class: booked / waitlist / attended and the history
// (cancels, late cancels and no-shows with what they burned).
export const buildClassOccurrenceView = async (
    prisma: PrismaService,
    cls: LoadedClass,
): Promise<ClassOccurrenceOutput> => {
    const where = {
        workspaceId_occurrenceKey: {
            workspaceId: cls.workspaceId,
            occurrenceKey: cls.occurrenceKey,
        },
    }
    const occurrence = await prisma.classOccurrence.findUnique({
        where,
        select: {
            capacity: true,
            settledAt: true,
            bookings: {
                select: {
                    id: true,
                    userId: true,
                    status: true,
                    bookedById: true,
                    overCapacity: true,
                    promotedAt: true,
                    cancelledAt: true,
                    classBurned: true,
                    createdAt: true,
                    user: {
                        select: { firstname: true, lastname: true, email: true },
                    },
                    burnedSubscription: {
                        select: { plan: { select: { name: true } } },
                    },
                },
            },
        },
    })
    const session = await prisma.attendanceSession.findUnique({
        where,
        select: { records: { select: { userId: true } } },
    })
    const present = new Set(session?.records.map((r) => r.userId) ?? [])
    const rows = occurrence?.bookings ?? []
    const positions = waitlistPositions(rows)
    const bookings = rows
        .map((b) => ({
            bookingId: b.id,
            userId: b.userId,
            displayName: displayName(b.user),
            status: b.status,
            waitlistPosition: positions.get(b.id) ?? null,
            attended: present.has(b.userId),
            overCapacity: b.overCapacity,
            bookedByOther: b.bookedById !== null && b.bookedById !== b.userId,
            promotedAt: b.promotedAt?.toISOString() ?? null,
            cancelledAt: b.cancelledAt?.toISOString() ?? null,
            classBurned: b.classBurned,
            burnedPlanName: b.burnedSubscription?.plan.name ?? null,
            createdAt: b.createdAt.toISOString(),
            at: b.createdAt.getTime(),
        }))
        .sort(
            (a, b) =>
                STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
                (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) ||
                a.at - b.at,
        )
        .map(({ at: _at, ...row }) => row)

    return {
        ...serializeClassRef({
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
        }),
        capacity: effectiveCapacity({
            occurrence: occurrence?.capacity,
            slot: cls.slot.capacity,
            group: cls.group.capacity,
        }),
        capacityOverride: occurrence?.capacity ?? null,
        booked: bookings.filter((b) => HELD_PLACE.has(b.status)).length,
        waitlist: bookings.filter((b) => b.status === 'WAITLISTED').length,
        attended: present.size,
        cancelDeadline: cancelDeadline(
            cls.occ.startAt,
            cls.settings.cancelHours,
        ).toISOString(),
        settled: Boolean(occurrence?.settledAt),
        bookings,
    }
}
