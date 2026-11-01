import { z } from 'zod'

import { fullNameWithoutEmail } from '../../shared/utils/person-name'

export const ClassBookingStatusSchema = z.enum([
    'BOOKED',
    'WAITLISTED',
    'ATTENDED',
    'CANCELLED',
    'LATE_CANCELLED',
    'NO_SHOW',
    'CANCELLED_BY_CLUB',
    'EXPIRED',
])
export type ClassBookingStatusValue = z.infer<typeof ClassBookingStatusSchema>

const GymRefSchema = z
    .object({ id: z.string().uuid(), name: z.string(), address: z.string() })
    .nullable()

// The class a booking is for, as the member sees it.
const ClassRefFields = {
    slotId: z.string().uuid(),
    groupId: z.string().uuid(),
    groupName: z.string(),
    // slotId:yyyy-mm-dd — the same key the club schedule gives the occurrence.
    occurrenceId: z.string(),
    sessionDate: z.iso.date(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    // IANA zone the class wall-clock lives in (gym zone, else the club's).
    timezone: z.string(),
    gym: GymRefSchema,
    coachName: z.string(),
    // The club cancelled the class (schedule exception).
    classCancelled: z.boolean(),
}

// A member's booking of one class of a «Запись на занятие» group.
export const ClassBookingOutputSchema = z.object({
    id: z.string().uuid(),
    status: ClassBookingStatusSchema,
    ...ClassRefFields,
    // 1-based place in the waitlist; null unless WAITLISTED.
    waitlistPosition: z.number().int().nullable(),
    // Free cancel until this instant; later it is a late cancel.
    cancelDeadline: z.iso.datetime(),
    // Cancelling now counts as late (BOOKED, past the deadline, the spot was
    // not given from the waitlist after it).
    lateCancelNow: z.boolean(),
    // The club burns a class for a late cancel / a no-show.
    lateCancelBurns: z.boolean(),
    noShowBurns: z.boolean(),
    // Got the spot from the waitlist at this instant.
    promotedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    // Staff added it while the class was full.
    overCapacity: z.boolean(),
    // A late cancel / no-show took a class from this abonement.
    classBurned: z.boolean(),
    burnedPlanName: z.string().nullable(),
    createdAt: z.iso.datetime(),
})
export type ClassBookingOutput = z.infer<typeof ClassBookingOutputSchema>

export type LoadedClassRef = {
    slotId: string
    sessionDate: string
    groupId: string
    groupName: string
    gym: { id: string; name: string; address: string } | null
    coach: { firstname: string | null; lastname: string | null; email: string | null }
    startAt: Date
    endAt: Date
    timezone: string
    cancelled: boolean
}

export const serializeClassRef = (c: LoadedClassRef) => ({
    slotId: c.slotId,
    groupId: c.groupId,
    groupName: c.groupName,
    occurrenceId: `${c.slotId}:${c.sessionDate}`,
    sessionDate: c.sessionDate,
    startAt: c.startAt.toISOString(),
    endAt: c.endAt.toISOString(),
    timezone: c.timezone,
    gym: c.gym
        ? { id: c.gym.id, name: c.gym.name, address: c.gym.address }
        : null,
    coachName: fullNameWithoutEmail(c.coach),
    classCancelled: c.cancelled,
})

// One row of the staff roster of a class.
export const ClassRosterEntrySchema = z.object({
    bookingId: z.string().uuid(),
    userId: z.string().uuid(),
    displayName: z.string(),
    status: ClassBookingStatusSchema,
    waitlistPosition: z.number().int().nullable(),
    // Marked present on the class's attendance session.
    attended: z.boolean(),
    overCapacity: z.boolean(),
    // Booked by staff or a guardian (not the member themself).
    bookedByOther: z.boolean(),
    promotedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    classBurned: z.boolean(),
    burnedPlanName: z.string().nullable(),
    createdAt: z.iso.datetime(),
})
export type ClassRosterEntry = z.infer<typeof ClassRosterEntrySchema>

export const ClassOccurrenceOutputSchema = z.object({
    ...ClassRefFields,
    // Spots of this class (date override, else slot, else group); null = unlimited.
    capacity: z.number().int().nullable(),
    // The date's own override (null = inherits slot/group).
    capacityOverride: z.number().int().nullable(),
    booked: z.number().int(),
    waitlist: z.number().int(),
    attended: z.number().int(),
    cancelDeadline: z.iso.datetime(),
    // The after-class sweep closed it (no-shows recorded).
    settled: z.boolean(),
    // Live bookings first (booked, then the waitlist in order), then history.
    bookings: z.array(ClassRosterEntrySchema),
})
export type ClassOccurrenceOutput = z.infer<typeof ClassOccurrenceOutputSchema>
