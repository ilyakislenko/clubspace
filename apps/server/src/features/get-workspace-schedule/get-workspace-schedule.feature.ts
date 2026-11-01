import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'
import { ScheduleSubstitutionSchema } from '../class-substitutions/schemas'
import { EventOutputSchema } from '../manage-workspace-events/schemas'

export const GetWorkspaceScheduleFeatureInputSchema = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    // Only classes of groups and events tagged with this direction.
    directionId: z.string().uuid().optional(),
})

// Places of a class of a «Запись на занятие» group.
const ScheduleBookingSchema = z.object({
    // null = unlimited.
    capacity: z.number().int().nullable(),
    booked: z.number().int(),
    waitlist: z.number().int(),
    // Booking opens on this club-calendar day (window before the class).
    opensOn: z.iso.date(),
    // Free cancel until this instant.
    cancelDeadline: z.iso.datetime(),
    // The viewer's live booking of this class, if any.
    myBookingId: z.string().uuid().nullable(),
    myStatus: z.enum(['BOOKED', 'WAITLISTED']).nullable(),
    myWaitlistPosition: z.number().int().nullable(),
})

const SessionSchema = z.object({
    // Synthetic — combines slotId with the calendar date so the client
    // can use it as a stable React key when rendering. Not a DB row.
    occurrenceId: z.string(),
    slotId: z.string().uuid(),
    groupId: z.string().uuid(),
    group: z.object({
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
    }),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    durationMin: z.number().int(),
    dayOfWeek: z.number().int(),
    // IANA timezone the wall-clock for this occurrence lives in. Equal
    // to gym.timezone when the group has one, else workspace.timezone.
    timezone: z.string(),
    cancelled: z.boolean(),
    cancellationReason: z.string().nullable(),
    // Members of other groups who booked this class (drop-ins).
    bookedGuests: z.number().int(),
    // «Запись на занятие» groups only (null for a fixed group).
    booking: ScheduleBookingSchema.nullable(),
    // Another coach runs this class: APPROVED = «Замена: …» for everyone,
    // PENDING = a coach asked to take it (staff act on it). null = none.
    substitution: ScheduleSubstitutionSchema.nullable(),
})

export const GetWorkspaceScheduleFeatureOutputSchema = z.object({
    timezone: z.string(),
    sessions: z.array(SessionSchema),
    events: z.array(EventOutputSchema),
})

export class GetWorkspaceScheduleFeature {
    constructor(
        readonly payload: z.infer<
            typeof GetWorkspaceScheduleFeatureInputSchema
        >,
        readonly workspaceId: string,
        // Whose booking status `booking.my*` reports (the child under act-as);
        // null = nobody's (staff stats).
        readonly viewerUserId: string | null = null,
    ) {}
}

export type GetWorkspaceScheduleFeatureResponse = z.infer<
    typeof GetWorkspaceScheduleFeatureOutputSchema
>
