import { z } from 'zod'

import { Prisma } from '../../infrastructure/prisma'
import { resolveGroupSessionTz, wallClockToUtc } from '../attendance/attendance-utils'

const PersonRefSchema = z.object({
    id: z.string().uuid(),
    email: z.string().nullable(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
})

export const ClassSubstitutionStatusSchema = z.enum(['PENDING', 'APPROVED'])
export const ClassSubstitutionKindSchema = z.enum(['ASSIGN', 'OFFER'])

// One class run by another coach, with what the viewer may do about it.
export const ClassSubstitutionOutputSchema = z.object({
    id: z.string().uuid(),
    slotId: z.string().uuid(),
    // The club calendar day of the class.
    sessionDate: z.iso.date(),
    groupId: z.string().uuid(),
    groupName: z.string(),
    gym: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string(),
    status: ClassSubstitutionStatusSchema,
    kind: ClassSubstitutionKindSchema,
    substitute: PersonRefSchema,
    // The group's lead coach — whom the substitute stands in for.
    regularCoach: PersonRefSchema,
    requestedById: z.string().uuid(),
    decidedById: z.string().uuid().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
    // The viewer runs the group (its coach, the direction's manager, a club
    // admin): approves / declines a request, assigns and cancels.
    canDecide: z.boolean(),
    // The viewer may withdraw it: whoever can decide, the substitute, the
    // requester.
    canCancel: z.boolean(),
})
export type ClassSubstitutionOutput = z.infer<typeof ClassSubstitutionOutputSchema>

// What the schedule ships per class (members see «Замена: …» from it).
export const ScheduleSubstitutionSchema = z.object({
    id: z.string().uuid(),
    status: ClassSubstitutionStatusSchema,
    kind: ClassSubstitutionKindSchema,
    substitute: PersonRefSchema,
    requestedById: z.string().uuid(),
})

const personSelect = {
    select: { id: true, email: true, firstname: true, lastname: true },
} as const

export const classSubstitutionInclude = {
    substitute: personSelect,
    slot: { select: { startTime: true, durationMin: true } },
    workspace: { select: { timezone: true } },
    group: {
        select: {
            id: true,
            name: true,
            directionId: true,
            coachId: true,
            coach: personSelect,
            gym: { select: { id: true, name: true, timezone: true } },
            coaches: { select: { userId: true } },
        },
    },
} satisfies Prisma.ClassSubstitutionInclude

export type ClassSubstitutionRow = Prisma.ClassSubstitutionGetPayload<{
    include: typeof classSubstitutionInclude
}>

export const substitutionWhen = (row: ClassSubstitutionRow) => {
    const sessionDate = row.sessionDate.toISOString().slice(0, 10)
    const timezone = resolveGroupSessionTz(
        row.group.gym?.timezone ?? null,
        row.workspace.timezone,
    )
    const startAt = wallClockToUtc(`${sessionDate}T${row.slot.startTime}`, timezone)
    return {
        sessionDate,
        timezone,
        startAt,
        endAt: new Date(startAt.getTime() + row.slot.durationMin * 60_000),
    }
}

export const serializeClassSubstitution = (
    row: ClassSubstitutionRow,
    viewer: { userId: string; canDecide: boolean },
): ClassSubstitutionOutput => {
    const when = substitutionWhen(row)
    return {
        id: row.id,
        slotId: row.slotId,
        sessionDate: when.sessionDate,
        groupId: row.groupId,
        groupName: row.group.name,
        gym: row.group.gym
            ? { id: row.group.gym.id, name: row.group.gym.name }
            : null,
        startAt: when.startAt.toISOString(),
        endAt: when.endAt.toISOString(),
        timezone: when.timezone,
        status: row.status,
        kind: row.kind,
        substitute: row.substitute,
        regularCoach: row.group.coach,
        requestedById: row.requestedById,
        decidedById: row.decidedById,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        canDecide: viewer.canDecide,
        canCancel:
            viewer.canDecide ||
            row.substituteId === viewer.userId ||
            row.requestedById === viewer.userId,
    }
}
