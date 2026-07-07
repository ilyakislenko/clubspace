import { z } from 'zod'

export const PlanOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    price: z.number().int(),
    currency: z.string(),
    durationDays: z.number().int(),
    // Class-pack size (null = time-only tariff, no per-class limit).
    classCount: z.number().int().nullable(),
    isFreeTrial: z.boolean(),
    isActive: z.boolean(),
})
export type PlanOutput = z.infer<typeof PlanOutputSchema>

export const PlanDeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

export const serializePlan = (p: {
    id: string
    workspaceId: string | null
    name: string
    description: string | null
    price: number
    currency: string
    durationDays: number
    classCount: number | null
    isFreeTrial: boolean
    isActive: boolean
}): PlanOutput => ({
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    durationDays: p.durationDays,
    classCount: p.classCount,
    isFreeTrial: p.isFreeTrial,
    isActive: p.isActive,
})
