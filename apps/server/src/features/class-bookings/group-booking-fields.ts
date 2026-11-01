import { z } from 'zod'

// «Постоянная группа» / «Запись на занятие» — Group.bookingMode.
export const GroupBookingModeSchema = z.enum(['FIXED', 'BOOKING'])

// Booking settings of a group as create/update-group accept them. null clears
// an override (capacity: unlimited; window / deadline: the club's).
export const GroupBookingInputFields = {
    bookingMode: GroupBookingModeSchema.optional(),
    capacity: z.number().int().min(1).max(1000).nullish(),
    bookingWindowDays: z.number().int().min(0).max(90).nullish(),
    bookingCancelHours: z.number().int().min(0).max(168).nullish(),
}

export const GroupBookingOutputFields = {
    bookingMode: GroupBookingModeSchema,
    capacity: z.number().int().nullable(),
    bookingWindowDays: z.number().int().nullable(),
    bookingCancelHours: z.number().int().nullable(),
}

// The club-wide booking settings (Workspace columns) as the settings
// endpoints read and write them.
export const WorkspaceBookingSettingsFields = {
    bookingWindowDays: z.number().int().min(0).max(90),
    bookingCancelHours: z.number().int().min(0).max(168),
    bookingLateCancelBurn: z.boolean(),
    bookingNoShowBurn: z.boolean(),
}

export const workspaceBookingSettingsSelect = {
    bookingWindowDays: true,
    bookingCancelHours: true,
    bookingLateCancelBurn: true,
    bookingNoShowBurn: true,
} as const
