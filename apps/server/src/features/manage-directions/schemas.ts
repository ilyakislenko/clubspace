import { z } from 'zod'

export const DirectionColorSchema = z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB')

export const DirectionOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().nullable(),
    icon: z.string().nullable(),
    order: z.number().int(),
    isActive: z.boolean(),
    // Groups tagged with this direction.
    groupCount: z.number().int(),
    // The caller trains in or coaches a group of this direction.
    isMine: z.boolean(),
})
export type DirectionOutput = z.infer<typeof DirectionOutputSchema>

export const DirectionListOutputSchema = z.object({
    data: z.array(DirectionOutputSchema),
})

export const DirectionDeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

export const serializeDirection = (
    d: {
        id: string
        name: string
        color: string | null
        icon: string | null
        order: number
        isActive: boolean
        _count?: { groups: number }
    },
    isMine = false,
): DirectionOutput => ({
    id: d.id,
    name: d.name,
    color: d.color,
    icon: d.icon,
    order: d.order,
    isActive: d.isActive,
    groupCount: d._count?.groups ?? 0,
    isMine,
})

export const DIRECTION_ADMIN_MESSAGE =
    'Управлять направлениями может только администратор клуба'
