// Discounts read and applied inside a sale's transaction
// (docs/design/2026-11-15-discounts.md §3.1, §3.3): loading a discount as a
// rule, the row lock, the automatic (family) discount and the staff sale's
// pricing with every refusal.
import { localDateInTz } from '../../features/attendance/attendance-utils'
import type { Prisma, PrismaTransactionClientType } from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import {
    discountApplies,
    type DiscountRule,
    type PricedSale,
    priceSale,
    type SaleItem,
} from './discount-rules'
import { countDiscountUses } from './discount-uses'
import { loadFamilyEligibility } from './family'

type Tx = PrismaTransactionClientType

export const discountRuleSelect = {
    id: true,
    name: true,
    kind: true,
    value: true,
    currency: true,
    code: true,
    isFamily: true,
    allPlans: true,
    events: true,
    startsOn: true,
    endsOn: true,
    maxUses: true,
    oncePerMember: true,
    isActive: true,
    plans: { select: { planId: true } },
} as const satisfies Prisma.DiscountSelect

export type DiscountRuleRow = Prisma.DiscountGetPayload<{ select: typeof discountRuleSelect }>

export const toDiscountRule = ({ plans, ...d }: DiscountRuleRow): DiscountRule => ({
    ...d,
    planIds: plans.map((p) => p.planId),
})

export const FAMILY_NOT_ELIGIBLE_MESSAGE =
    'Семейная скидка — только если у члена семьи есть действующий абонемент'

// Serializes the writers of one discount's uses (`maxUses`, `oncePerMember`)
// for the rest of the transaction: the WorkspaceEvent lock pattern.
export const lockDiscount = async (tx: Tx, id: string): Promise<boolean> => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Discount" WHERE "id" = ${id}::uuid FOR UPDATE`
    return rows.length > 0
}

// The club's active family discount when it prices `item` and the buyer
// qualifies — the online checkout and autopay apply it by themselves (a staff
// sale only preselects it). `today` = the club-local day; omitted = read from
// the club's time zone.
export const resolveAutomaticDiscount = async (
    tx: Pick<Tx, 'discount' | 'guardianship' | 'subscription' | 'workspace'>,
    p: { workspaceId: string; userId: string; item: SaleItem; now: Date; today?: string },
): Promise<DiscountRule | null> => {
    const row = await tx.discount.findFirst({
        where: { workspaceId: p.workspaceId, isFamily: true, isActive: true },
        select: discountRuleSelect,
        orderBy: { createdAt: 'asc' },
    })
    if (!row) return null
    const rule = toDiscountRule(row)
    const today = p.today ?? (await clubToday(tx, p.workspaceId, p.now))
    if (discountApplies(rule, p.item, today)) return null
    const eligible = await loadFamilyEligibility(tx, {
        workspaceId: p.workspaceId,
        userId: p.userId,
        now: p.now,
    })
    return eligible ? rule : null
}

const clubToday = async (
    tx: Pick<Tx, 'workspace'>,
    workspaceId: string,
    now: Date,
): Promise<string> => {
    const ws = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { timezone: true },
    })
    return localDateInTz(now, ws?.timezone ?? 'UTC')
}

// A staff sale with a discount the seller picked: lock → discountApplies →
// family condition → uses (exact under the lock) → priceSale. Any active
// discount of the club may be picked (staff-only, with a code, or family
// when the buyer qualifies). Throws the 400 the seller reads.
export const priceStaffSale = async (
    tx: Tx,
    p: {
        workspaceId: string
        discountId: string
        // The buyer.
        userId: string
        item: SaleItem
        now: Date
        timezone: string
    },
): Promise<PricedSale> => {
    await lockDiscount(tx, p.discountId)
    const row = await tx.discount.findFirst({
        where: { id: p.discountId, workspaceId: p.workspaceId },
        select: discountRuleSelect,
    })
    if (!row) throw new NotFoundError({ message: 'Скидка не найдена' })
    const rule = toDiscountRule(row)
    const refusal = discountApplies(rule, p.item, localDateInTz(p.now, p.timezone))
    if (refusal) throw new BadRequestError({ message: refusal.message })
    if (rule.isFamily) {
        const eligible = await loadFamilyEligibility(tx, {
            workspaceId: p.workspaceId,
            userId: p.userId,
            now: p.now,
        })
        if (!eligible) throw new BadRequestError({ message: FAMILY_NOT_ELIGIBLE_MESSAGE })
    }
    if (rule.oncePerMember) {
        const mine = await countDiscountUses(tx, rule.id, { userId: p.userId })
        if (mine > 0) {
            throw new BadRequestError({
                message: `Скидка «${rule.name}» уже использована этим учеником`,
            })
        }
    }
    if (rule.maxUses !== null) {
        const uses = await countDiscountUses(tx, rule.id)
        if (uses >= rule.maxUses) {
            throw new BadRequestError({ message: `Лимит скидки «${rule.name}» исчерпан` })
        }
    }
    return priceSale({ listPrice: p.item.listPrice, currency: p.item.currency, discount: rule })
}
