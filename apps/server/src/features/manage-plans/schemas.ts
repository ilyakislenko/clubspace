import { z } from 'zod'

import {
    type DirectionRef,
    directionRefSelect,
    DirectionRefSchema,
} from '../../domains/directions/direction-ref'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'

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
    // Members may opt in to renew it automatically when paying online
    // (docs/design/2026-11-15-member-autopay.md §3.5). Needs purchasableOnline
    // and the club's autopay setting.
    autopayAvailable: z.boolean(),
    // Directions an abonement of this tariff may be spent on (snapshotted
    // into each sale). Empty = club-wide.
    directions: z.array(DirectionRefSchema),
    // The version an edit sends back as `expectedUpdatedAt`.
    updatedAt: z.iso.datetime(),
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
    autopayAvailable: boolean
    directions: ReadonlyArray<{ direction: DirectionRef }>
    updatedAt: Date
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
    autopayAvailable: p.autopayAvailable,
    directions: p.directions.map((d) => d.direction),
    updatedAt: p.updatedAt.toISOString(),
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

// Tariffs and prices are club money: the owner and admins only.
export const PLAN_WRITE_REFUSAL = 'Тарифы меняют владелец и администраторы клуба'

// A free tariff (zero price, or the once-per-member trial) is never sold
// online: there is nothing to pay, and the trial rule lives in the admin flow.
export const ONLINE_FREE_PLAN_MESSAGE =
    'Бесплатный тариф нельзя продавать онлайн'
export const canSellOnline = (p: { price: number; isFreeTrial: boolean }) =>
    p.price > 0 && !p.isFreeTrial

// Autopay renews an online sale, so it needs one (canSellOnline included),
// and the club must offer autopay: YooKassa with the setting on.
export const AUTOPAY_NEEDS_ONLINE_MESSAGE =
    'Продлевать автоплатежом можно только тариф, который покупают онлайн'
export const AUTOPAY_CLUB_OFF_MESSAGE =
    'Включите автоплатежи в разделе «Онлайн-оплата»'
export const assertClubOffersAutopay = async (
    prisma: Pick<PrismaService, 'workspacePaymentSettings'>,
    workspaceId: string,
): Promise<void> => {
    const settings = await prisma.workspacePaymentSettings.findUnique({
        where: { workspaceId },
        select: { provider: true, autopayEnabled: true },
    })
    if (settings?.provider !== 'YOOKASSA' || !settings.autopayEnabled) {
        throw new BadRequestError({ message: AUTOPAY_CLUB_OFF_MESSAGE })
    }
}

// Why live agreements on this tariff stop when it no longer renews by autopay.
export const PLAN_AUTOPAY_OFF_REASON = 'клуб больше не продлевает этот тариф автоматически'
