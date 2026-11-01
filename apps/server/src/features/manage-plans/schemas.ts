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
    // The abonement waits for the member's first visit instead of the sale day.
    startsOnFirstVisit: z.boolean(),
    isActive: z.boolean(),
    // Members can buy it in the app («Оплатить онлайн»).
    purchasableOnline: z.boolean(),
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
    startsOnFirstVisit: boolean
    isActive: boolean
    purchasableOnline: boolean
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
    startsOnFirstVisit: p.startsOnFirstVisit,
    isActive: p.isActive,
    purchasableOnline: p.purchasableOnline,
})

// A free tariff (zero price, or the once-per-member trial) is never sold
// online: there is nothing to pay, and the trial rule lives in the admin flow.
export const ONLINE_FREE_PLAN_MESSAGE =
    'Бесплатный тариф нельзя продавать онлайн'
export const canSellOnline = (p: { price: number; isFreeTrial: boolean }) =>
    p.price > 0 && !p.isFreeTrial
