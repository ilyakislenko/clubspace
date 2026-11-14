import { z } from 'zod'

import {
    directionRefSelect,
    DirectionRefSchema,
} from '../../domains/directions/direction-ref'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    GroupBookingModeSchema,
    GroupBookingOutputFields,
} from '../class-bookings/group-booking-fields'
import {
    ExceptionOutputSchema,
    serializeException,
    serializeSlot,
    SlotOutputSchema,
} from '../manage-group-schedule/schemas'

// One group as the admin lists it («Группы и залы», pickers and filters on
// other pages): hall, direction, coaches, size and the days it trains. No
// roster — that is `GET groups/:groupId/members`, paged.

export const userRefSelect = {
    select: { id: true, email: true, firstname: true, lastname: true },
} as const

const GroupCoachRefSchema = z.object({
    userId: z.string().uuid(),
    email: z.string().nullable(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    role: z.enum(['primary', 'assistant']),
})

// A weekly class of the group as of today: recurring slots that still run
// (no end, or ending today or later); one-off classes are not part of the week.
const WeeklyClassSchema = z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string(),
})

export const GroupListRowSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    gym: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    direction: DirectionRefSchema.nullable(),
    coach: z.object({
        id: z.string().uuid(),
        email: z.string().nullable(),
        firstname: z.string().nullable(),
        lastname: z.string().nullable(),
    }),
    // «Постоянная группа» / «Запись на занятие»; its spots and overrides are
    // on the card.
    bookingMode: GroupBookingModeSchema,
    // Every coach including the primary (mirrored from `coach` above).
    coaches: z.array(GroupCoachRefSchema),
    memberCount: z.number().int(),
    // Ordered by day, then time; one entry per distinct day + time.
    week: z.array(WeeklyClassSchema),
})
export type GroupListRow = z.infer<typeof GroupListRowSchema>

const groupListRowShape = {
    gym: { select: { id: true, name: true } },
    direction: directionRefSelect,
    coach: userRefSelect,
    coaches: { include: { user: userRefSelect } },
    slots: {
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        select: {
            dayOfWeek: true,
            startTime: true,
            effectiveFrom: true,
            effectiveUntil: true,
        },
    },
    _count: { select: { members: true } },
} as const satisfies Prisma.GroupInclude

type GroupListRowSource = Prisma.GroupGetPayload<{
    include: typeof groupListRowShape
}>

// Slots that still run or are upcoming. Ended ones stay readable through the
// schedule endpoint.
const runningSlotsWhere = (today: Date): Prisma.GroupScheduleSlotWhereInput => ({
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: today } }],
})

export const groupListRowInclude = (today: Date) =>
    ({
        ...groupListRowShape,
        slots: { ...groupListRowShape.slots, where: runningSlotsWhere(today) },
    }) satisfies Prisma.GroupInclude

export const serializeGroupListRow = (
    group: Omit<GroupListRowSource, 'gym'> & {
        gym: { id: string; name: string } | null
    },
): GroupListRow => {
    const week = new Map<string, z.infer<typeof WeeklyClassSchema>>()
    for (const s of group.slots) {
        const oneOff =
            !!s.effectiveFrom &&
            !!s.effectiveUntil &&
            s.effectiveFrom.getTime() === s.effectiveUntil.getTime()
        if (oneOff) continue
        week.set(`${s.dayOfWeek}|${s.startTime}`, {
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
        })
    }
    return {
        id: group.id,
        name: group.name,
        gym: group.gym ? { id: group.gym.id, name: group.gym.name } : null,
        direction: group.direction,
        coach: group.coach,
        bookingMode: group.bookingMode,
        coaches: group.coaches.map((c) => ({
            userId: c.user.id,
            email: c.user.email,
            firstname: c.user.firstname,
            lastname: c.user.lastname,
            role: c.role as 'primary' | 'assistant',
        })),
        memberCount: group._count.members,
        week: [...week.values()],
    }
}

// The group card: the list row plus the hall's address, booking spots and
// overrides, and the group's running/upcoming slots and ongoing/future
// exceptions (read-only there; the calendar edits them and reads them for a
// class it opens).
export const GroupDetailsSchema = GroupListRowSchema.extend({
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    ...GroupBookingOutputFields,
    slots: z.array(SlotOutputSchema),
    exceptions: z.array(ExceptionOutputSchema),
})

const groupDetailsShape = {
    ...groupListRowShape,
    gym: { select: { id: true, name: true, address: true } },
    slots: { orderBy: groupListRowShape.slots.orderBy },
    exceptions: { orderBy: { fromDate: 'asc' } },
} as const satisfies Prisma.GroupInclude

type GroupDetailsSource = Prisma.GroupGetPayload<{
    include: typeof groupDetailsShape
}>

export const groupDetailsInclude = (today: Date) =>
    ({
        ...groupDetailsShape,
        slots: { ...groupDetailsShape.slots, where: runningSlotsWhere(today) },
        exceptions: {
            ...groupDetailsShape.exceptions,
            where: { untilDate: { gte: today } },
        },
    }) satisfies Prisma.GroupInclude

export const serializeGroupDetails = (
    group: GroupDetailsSource,
): z.infer<typeof GroupDetailsSchema> => ({
    ...serializeGroupListRow(group),
    gym: group.gym,
    capacity: group.capacity,
    bookingWindowDays: group.bookingWindowDays,
    bookingCancelHours: group.bookingCancelHours,
    slots: group.slots.map(serializeSlot),
    exceptions: group.exceptions.map(serializeException),
})

// Today in the club's time zone, as a @db.Date column compares (midnight UTC
// of that calendar date) — the day boundary the schedule code uses.
export const clubToday = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<Date> => {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { timezone: true },
    })
    const ymd = localDateInTz(new Date(), workspace?.timezone ?? 'UTC')
    return new Date(`${ymd}T00:00:00.000Z`)
}
