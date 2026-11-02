import { z } from 'zod'

import {
    directionRefSelect,
    DirectionRefSchema,
} from '../../domains/directions/direction-ref'
import type { Prisma } from '../../infrastructure/prisma'
import { GroupBookingOutputFields } from '../class-bookings/group-booking-fields'

// One group as the admin's «Группы и расписание» list and the group page show
// it: hall, direction, coaches, roster, weekly slots and upcoming exceptions.

export const GroupMemberSchema = z.object({
    userId: z.string().uuid(),
    email: z.string().nullable(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    joinedAt: z.iso.datetime(),
})

const SlotSchema = z.object({
    id: z.string().uuid(),
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string(),
    durationMin: z.number().int(),
    effectiveFrom: z.iso.date().nullable(),
    effectiveUntil: z.iso.date().nullable(),
    // Spots per class («Запись на занятие»); null = the group's.
    capacity: z.number().int().nullable(),
})

const ExceptionSchema = z.object({
    id: z.string().uuid(),
    slotId: z.string().uuid().nullable(),
    fromDate: z.iso.date(),
    untilDate: z.iso.date(),
    reason: z.string().nullable(),
})

export const GroupRowSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    direction: DirectionRefSchema.nullable(),
    coach: z.object({
        id: z.string().uuid(),
        email: z.string().nullable(),
        firstname: z.string().nullable(),
        lastname: z.string().nullable(),
    }),
    // «Постоянная группа» / «Запись на занятие» and its spots / overrides.
    ...GroupBookingOutputFields,
    // Full coach roster including the primary (mirrored from `coach`
    // above). Clients can pick the right rendering: chip per coach, or
    // primary + "+ N помощников".
    coaches: z.array(
        z.object({
            userId: z.string().uuid(),
            email: z.string().nullable(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
            role: z.enum(['primary', 'assistant']),
        }),
    ),
    memberCount: z.number().int(),
    members: z.array(GroupMemberSchema),
    slots: z.array(SlotSchema),
    exceptions: z.array(ExceptionSchema),
    createdAt: z.iso.datetime(),
})
export type GroupRow = z.infer<typeof GroupRowSchema>

const userRefSelect = {
    select: { id: true, email: true, firstname: true, lastname: true },
} as const

const groupRowIncludeShape = {
    gym: { select: { id: true, name: true, address: true } },
    direction: directionRefSelect,
    coach: userRefSelect,
    coaches: { include: { user: userRefSelect } },
    members: {
        orderBy: { joinedAt: 'asc' },
        include: { user: userRefSelect },
    },
    slots: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
    exceptions: { orderBy: { fromDate: 'asc' } },
    _count: { select: { members: true } },
} as const satisfies Prisma.GroupInclude

// What serializeGroupRow reads.
export type GroupRowSource = Prisma.GroupGetPayload<{
    include: typeof groupRowIncludeShape
}>

// `include` for a row passed to serializeGroupRow. Only ongoing/future
// exceptions: old vacations don't need to clutter the admin views. The
// projection endpoint still serves them for any specific window asked for.
export const groupRowInclude = (now: Date) =>
    ({
        ...groupRowIncludeShape,
        exceptions: {
            ...groupRowIncludeShape.exceptions,
            where: { untilDate: { gte: now } },
        },
    }) satisfies Prisma.GroupInclude

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

export const serializeGroupRow = (group: GroupRowSource): GroupRow => ({
    id: group.id,
    name: group.name,
    gym: group.gym,
    direction: group.direction,
    coach: group.coach,
    bookingMode: group.bookingMode,
    capacity: group.capacity,
    bookingWindowDays: group.bookingWindowDays,
    bookingCancelHours: group.bookingCancelHours,
    coaches: group.coaches.map((c) => ({
        userId: c.user.id,
        email: c.user.email,
        firstname: c.user.firstname,
        lastname: c.user.lastname,
        role: c.role as 'primary' | 'assistant',
    })),
    memberCount: group._count.members,
    members: group.members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        firstname: m.user.firstname,
        lastname: m.user.lastname,
        joinedAt: m.joinedAt.toISOString(),
    })),
    slots: group.slots.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        durationMin: s.durationMin,
        effectiveFrom: s.effectiveFrom ? isoDate(s.effectiveFrom) : null,
        effectiveUntil: s.effectiveUntil ? isoDate(s.effectiveUntil) : null,
        capacity: s.capacity,
    })),
    exceptions: group.exceptions.map((e) => ({
        id: e.id,
        slotId: e.slotId,
        fromDate: isoDate(e.fromDate),
        untilDate: isoDate(e.untilDate),
        reason: e.reason,
    })),
    createdAt: group.createdAt.toISOString(),
})
