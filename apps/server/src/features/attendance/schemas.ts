import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'

// An abonement a visit is (or would be) spent on — domains/subscriptions/
// visit-abonement.ts (toVisitAbonement). classesRemaining null = time-based
// (counts the visit without deducting). directions empty = club-wide.
export const VisitAbonementSchema = z.object({
    subscriptionId: z.string().uuid(),
    planName: z.string(),
    classesTotal: z.number().int().nullable(),
    classesRemaining: z.number().int().nullable(),
    endDate: z.iso.datetime().nullable(),
    directions: z.array(DirectionRefSchema),
})

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

// Which abonement a visit is (or would be) spent on. Present → the one it was
// attributed to (null = no abonement could pay); not present → the one a mark
// would use now (the precedence's first). Options: every abonement this class
// may be spent on, in precedence order (present: the used one first). Personal
// sessions never touch abonements: null / [].
const visitAbonementFields = {
    abonement: VisitAbonementSchema.nullable(),
    abonementOptions: z.array(VisitAbonementSchema),
}

export const RosterEntrySchema = z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
    present: z.boolean(),
    isGuest: z.boolean().nullable(),
    // Last day (YYYY-MM-DD) of a freeze of a current abonement covering the
    // session's day, so the coach can see the member is paused — only when no
    // unfrozen abonement can pay for this class. Null otherwise.
    frozenUntil: z.iso.date().nullable(),
    // True when the member has a sold abonement not paid yet, so the coach can
    // mark the payment. Null = no member row (the owner, a removed member), so
    // there is no abonement to open.
    awaitingPayment: z.boolean().nullable(),
    // The viewer may open this member's abonement card (a member row exists and
    // the member is in the viewer's own groups, or the viewer sees all groups).
    canViewSubscription: z.boolean(),
    ...visitAbonementFields,
})
export type RosterEntry = z.infer<typeof RosterEntrySchema>
// A member of another group who booked this class and is not on the roster
// yet (or is, once marked). `source` is 'booking' for a drop-in, 'personal' for
// the one member of a 1:1 session.
export const ExpectedAttendeeSchema = z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
    present: z.boolean(),
    source: z.enum(['booking', 'personal']),
    // Same meaning as on roster entries.
    frozenUntil: z.iso.date().nullable(),
    // Classes left on `abonement` (0 when only an exhausted pack covers the
    // class); null = time-based or none, so nothing to warn about.
    classesLeft: z.number().int().nullable(),
    ...visitAbonementFields,
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

// Roster display name: "First Last" when present, else the email, else the
// generic placeholder (dependents have no email).
export const displayName = (u: {
    firstname: string | null
    lastname: string | null
    email: string | null
}): string =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim() ||
    u.email ||
    'Участник'
