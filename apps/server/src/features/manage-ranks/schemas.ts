import { z } from 'zod'

export const RankLevelOutputSchema = z.object({
    id: z.string().uuid(),
    ladderId: z.string().uuid(),
    name: z.string(),
    order: z.number().int(),
    color: z.string().nullable(),
    maxStripes: z.number().int(),
    requirements: z.string().nullable(),
    isActive: z.boolean(),
})
export type RankLevelOutput = z.infer<typeof RankLevelOutputSchema>

export const RankLadderOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string(),
    audience: z.string().nullable(),
    isActive: z.boolean(),
    order: z.number().int(),
    levels: z.array(RankLevelOutputSchema),
})
export type RankLadderOutput = z.infer<typeof RankLadderOutputSchema>

export const RankDeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

export const serializeLevel = (l: {
    id: string
    ladderId: string
    name: string
    order: number
    color: string | null
    maxStripes: number
    requirements: string | null
    isActive: boolean
}): RankLevelOutput => ({
    id: l.id,
    ladderId: l.ladderId,
    name: l.name,
    order: l.order,
    color: l.color,
    maxStripes: l.maxStripes,
    requirements: l.requirements,
    isActive: l.isActive,
})

export const serializeLadder = (l: {
    id: string
    workspaceId: string
    name: string
    audience: string | null
    isActive: boolean
    order: number
    levels?: Parameters<typeof serializeLevel>[0][]
}): RankLadderOutput => ({
    id: l.id,
    workspaceId: l.workspaceId,
    name: l.name,
    audience: l.audience,
    isActive: l.isActive,
    order: l.order,
    levels: (l.levels ?? []).map(serializeLevel),
})
