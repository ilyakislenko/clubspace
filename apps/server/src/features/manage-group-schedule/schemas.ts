import { z } from 'zod'

// HH:MM 24h. Hours 00-23, minutes 00-59. Stored as a wall-clock string in
// the workspace's timezone so DST shifts don't drift the meaning.
export const TimeOfDay = z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24h)')

export const SlotOutputSchema = z.object({
    id: z.string().uuid(),
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string(),
    durationMin: z.number().int(),
    effectiveFrom: z.iso.date().nullable(),
    effectiveUntil: z.iso.date().nullable(),
})

export const ExceptionOutputSchema = z.object({
    id: z.string().uuid(),
    slotId: z.string().uuid().nullable(),
    fromDate: z.iso.date(),
    untilDate: z.iso.date(),
    reason: z.string().nullable(),
})

export const DeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

export type SlotOutput = z.infer<typeof SlotOutputSchema>
export type ExceptionOutput = z.infer<typeof ExceptionOutputSchema>
export type DeletedOutput = z.infer<typeof DeletedOutputSchema>

// Convert Prisma's Date column (date-only) to YYYY-MM-DD. Prisma returns
// these as Date objects representing midnight UTC, so slicing the ISO
// string is enough — never apply timezone math here, the date IS the
// stored value.
export const isoDate = (d: Date) => d.toISOString().slice(0, 10)

export const serializeSlot = (s: {
    id: string
    dayOfWeek: number
    startTime: string
    durationMin: number
    effectiveFrom: Date | null
    effectiveUntil: Date | null
}): SlotOutput => ({
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    durationMin: s.durationMin,
    effectiveFrom: s.effectiveFrom ? isoDate(s.effectiveFrom) : null,
    effectiveUntil: s.effectiveUntil ? isoDate(s.effectiveUntil) : null,
})

export const serializeException = (e: {
    id: string
    slotId: string | null
    fromDate: Date
    untilDate: Date
    reason: string | null
}): ExceptionOutput => ({
    id: e.id,
    slotId: e.slotId,
    fromDate: isoDate(e.fromDate),
    untilDate: isoDate(e.untilDate),
    reason: e.reason,
})
