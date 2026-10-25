import { z } from 'zod'

export const AttendanceSessionOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    groupId: z.string().uuid().nullable(),
    slotId: z.string().uuid().nullable(),
    workspaceEventId: z.string().uuid().nullable(),
    sessionDate: z.string().nullable(), // yyyy-mm-dd
    title: z.string(),
    startAt: z.iso.datetime(),
    timezone: z.string(),
    coachId: z.string().uuid().nullable(),
    notes: z.string().nullable(),
    attendeeCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export type AttendanceSessionOutput = z.infer<
    typeof AttendanceSessionOutputSchema
>

export const RosterEntrySchema = z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
    present: z.boolean(),
    isGuest: z.boolean().nullable(),
    // Last day (YYYY-MM-DD) of the freeze that covers the session's day, so the
    // coach can see the abonement is paused. Null when not frozen.
    frozenUntil: z.iso.date().nullable(),
})
// A member of another group who booked this class and is not on the roster
// yet (or is, once marked). `source` is 'booking' for a drop-in, 'personal' for
// the one member of a 1:1 session.
export const ExpectedAttendeeSchema = z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
    present: z.boolean(),
    source: z.enum(['booking', 'personal']),
    // Same meaning as on roster entries: last day of the freeze covering the
    // class day, null when not frozen.
    frozenUntil: z.iso.date().nullable(),
    // Classes left on the guest's usable abonement; null = no usable pack or
    // no class balance (time-only), so nothing to warn about.
    classesLeft: z.number().int().nullable(),
})
export type ExpectedAttendee = z.infer<typeof ExpectedAttendeeSchema>
export const SessionRosterOutputSchema = z.object({
    sessionId: z.string().uuid(),
    kind: z.enum(['scheduled', 'adhoc', 'event', 'personal']),
    // Coach-only self-check-in code (roster is never member-facing).
    checkInCode: z.string().nullable(),
    roster: z.array(RosterEntrySchema),
    expected: z.array(ExpectedAttendeeSchema),
})
export type SessionRosterOutput = z.infer<typeof SessionRosterOutputSchema>

export const DeletedOutputSchema = z.object({ status: z.literal('deleted') })

const toDateStr = (d: Date | null): string | null =>
    d ? d.toISOString().slice(0, 10) : null

export const serializeSession = (s: {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    workspaceEventId: string | null
    sessionDate: Date | null
    title: string
    startAt: Date
    timezone: string
    coachId: string | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count?: { records: number }
}): AttendanceSessionOutput => ({
    id: s.id,
    workspaceId: s.workspaceId,
    groupId: s.groupId,
    slotId: s.slotId,
    workspaceEventId: s.workspaceEventId,
    sessionDate: toDateStr(s.sessionDate),
    title: s.title,
    startAt: s.startAt.toISOString(),
    timezone: s.timezone,
    coachId: s.coachId,
    notes: s.notes,
    attendeeCount: s._count?.records ?? 0,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
})

// Roster display name: "First Last" when present, else the email.
export const displayName = (u: {
    firstname: string | null
    lastname: string | null
    email: string
}): string =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || u.email
