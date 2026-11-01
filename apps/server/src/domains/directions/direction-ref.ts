import { z } from 'zod'

// The compact direction a tagged row (group, ladder, event, tariff,
// announcement) carries in its DTO, so clients can render the chip without a
// second lookup. null = club-wide.
export const DirectionRefSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().nullable(),
    icon: z.string().nullable(),
})
export type DirectionRef = z.infer<typeof DirectionRefSchema>

// Prisma `include`/`select` fragment matching DirectionRefSchema.
export const directionRefSelect = {
    select: { id: true, name: true, color: true, icon: true },
} as const
