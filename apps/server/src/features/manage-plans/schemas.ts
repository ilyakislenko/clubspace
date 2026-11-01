import { z } from 'zod'

import {
    type DirectionRef,
    directionRefSelect,
    DirectionRefSchema,
} from '../../domains/directions/direction-ref'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'

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
    // Directions an abonement of this tariff may be spent on (snapshotted
    // into each sale). Empty = club-wide.
    directions: z.array(DirectionRefSchema),
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
    directions: ReadonlyArray<{ direction: DirectionRef }>
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
    directions: p.directions.map((d) => d.direction),
})

// `include` for a plan row passed to serializePlan.
export const planDtoInclude = {
    directions: {
        select: { direction: directionRefSelect },
        orderBy: [{ direction: { order: 'asc' } }, { direction: { name: 'asc' } }],
    },
} as const satisfies Prisma.PlanInclude

// Every id of a tariff's scope must be a direction of this club (404 like a
// single foreign direction id). Returns the ids with duplicates collapsed.
export const assertDirectionsInWorkspace = async (
    prisma: Pick<PrismaService, 'direction'>,
    workspaceId: string,
    directionIds: readonly string[],
): Promise<string[]> => {
    const ids = [...new Set(directionIds)]
    if (ids.length === 0) return ids
    const found = await prisma.direction.findMany({
        where: { id: { in: ids }, workspaceId },
        select: { id: true },
    })
    if (found.length !== ids.length) {
        throw new NotFoundError({ message: 'Направление не найдено' })
    }
    return ids
}

// A free tariff (zero price, or the once-per-member trial) is never sold
// online: there is nothing to pay, and the trial rule lives in the admin flow.
export const ONLINE_FREE_PLAN_MESSAGE =
    'Бесплатный тариф нельзя продавать онлайн'
export const canSellOnline = (p: { price: number; isFreeTrial: boolean }) =>
    p.price > 0 && !p.isFreeTrial
