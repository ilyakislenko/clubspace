import { z } from 'zod'

import {
    discountStatus,
    normalizePromoCode,
    type DiscountKindValue,
} from '../../domains/discounts/discount-rules'
import { discountRuleSelect, toDiscountRule } from '../../domains/discounts/discounts'
import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import type { Prisma } from '../../infrastructure/prisma'

export const DiscountKindSchema = z.enum(['PERCENT', 'FIXED'])

export const DISCOUNT_FIXED_MAX = 10_000_000
export const DISCOUNT_MAX_USES = 100_000
export const DISCOUNT_MAX_PLANS = 100
// The club's discounts list is short (the tariffs list precedent): no paging.
export const DISCOUNT_LIST_LIMIT = 200

// The fields of a discount as the edit form sends them
// (docs/design/2026-11-15-discounts.md §3.2). The rules spanning fields
// (discountShapeIssue) run in superRefine on create and on the merged row on
// update.
export const DiscountFieldsSchema = z.object({
    name: z.string().trim().min(1).max(100),
    kind: DiscountKindSchema,
    // PERCENT 1–100, FIXED 1–10 000 000 (whole units of `currency`).
    value: z.number().int().min(1).max(DISCOUNT_FIXED_MAX),
    // FIXED only (required there); absent for PERCENT.
    currency: z.string().trim().length(3).nullable().optional(),
    // Promo code: members may enter it at checkout. Stored normalized
    // (upper-case, Ё→Е; 3–32 of A–Z, А–Я, 0–9, «-»). null = staff-only.
    code: z.string().trim().max(32).nullable().optional(),
    // Applied by itself when another family member holds a current
    // abonement; at most one active per club; never with a code or limits.
    isFamily: z.boolean().optional(),
    // Every tariff (default), or only planIds.
    allPlans: z.boolean().optional(),
    planIds: z.array(z.string().uuid()).max(DISCOUNT_MAX_PLANS).optional(),
    // Every paid event too.
    events: z.boolean().optional(),
    // Club-local days, inclusive; null = open.
    startsOn: z.iso.date().nullable().optional(),
    endsOn: z.iso.date().nullable().optional(),
    // Uses across the club; null = unlimited.
    maxUses: z.number().int().min(1).max(DISCOUNT_MAX_USES).nullable().optional(),
    oncePerMember: z.boolean().optional(),
})

export type DiscountShape = {
    kind: DiscountKindValue
    value: number
    currency: string | null
    code: string | null
    isFamily: boolean
    allPlans: boolean
    planIds: readonly string[]
    events: boolean
    startsOn: string | null
    endsOn: string | null
    maxUses: number | null
    oncePerMember: boolean
}

export const PROMO_CODE_MESSAGE = 'Промокод — от 3 до 32 букв, цифр или дефисов'
export const CODE_TAKEN_MESSAGE = 'Такой промокод уже есть'
export const NAME_TAKEN_MESSAGE = 'Скидка с таким названием уже есть'
export const DISCOUNT_USED_MESSAGE = 'Скидкой уже пользовались — уберите её в архив'
export const familyTakenMessage = (name: string) => `В клубе уже есть семейная скидка «${name}»`

// The rules spanning fields; the first broken one's text, or null.
export const discountShapeIssue = (d: DiscountShape): string | null => {
    if (d.kind === 'PERCENT' && d.value > 100) return 'Процент скидки — от 1 до 100'
    if (d.kind === 'PERCENT' && d.currency) return 'У скидки в процентах нет валюты'
    if (d.kind === 'FIXED' && !d.currency) return 'Укажите валюту скидки'
    if (d.code !== null && normalizePromoCode(d.code) === null) return PROMO_CODE_MESSAGE
    if (d.isFamily && (d.code !== null || d.maxUses !== null || d.oncePerMember)) {
        return 'Семейная скидка применяется сама — без промокода и ограничений'
    }
    if (!d.allPlans && d.planIds.length === 0 && !d.events) {
        return 'Выберите, на что действует скидка'
    }
    if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) {
        return 'Дата окончания раньше даты начала'
    }
    return null
}

// A create payload with the defaults applied.
export const shapeOfInput = (p: z.infer<typeof DiscountFieldsSchema>): DiscountShape => ({
    kind: p.kind,
    value: p.value,
    currency: p.currency ? p.currency.toUpperCase() : null,
    code: p.code || null,
    isFamily: p.isFamily ?? false,
    allPlans: p.allPlans ?? true,
    planIds: p.planIds ?? [],
    events: p.events ?? false,
    startsOn: p.startsOn ?? null,
    endsOn: p.endsOn ?? null,
    maxUses: p.maxUses ?? null,
    oncePerMember: p.oncePerMember ?? false,
})

export const discountDtoSelect = {
    ...discountRuleSelect,
    plans: { select: { planId: true, plan: { select: { name: true } } } },
    createdAt: true,
    updatedAt: true,
} as const satisfies Prisma.DiscountSelect

export type DiscountDtoRow = Prisma.DiscountGetPayload<{ select: typeof discountDtoSelect }>

export const DiscountStatusSchema = z.enum(['active', 'scheduled', 'expired', 'exhausted', 'archived'])

const MoneySchema = z.object({ currency: z.string(), amount: z.number().int() })

export const DiscountOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    kind: DiscountKindSchema,
    value: z.number().int(),
    currency: z.string().nullable(),
    code: z.string().nullable(),
    isFamily: z.boolean(),
    allPlans: z.boolean(),
    // The tariffs of the scope (allPlans = false), by name.
    plans: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    events: z.boolean(),
    startsOn: z.iso.date().nullable(),
    endsOn: z.iso.date().nullable(),
    maxUses: z.number().int().nullable(),
    oncePerMember: z.boolean(),
    isActive: z.boolean(),
    status: DiscountStatusSchema,
    // Sales carrying it, except unpaid ones later cancelled; refunds keep it.
    uses: z.number().int(),
    // Σ of its part over its paid sales, per currency (refunds ignored).
    given: z.array(MoneySchema),
    createdAt: z.iso.datetime(),
    // The edit form's version (expectedUpdatedAt).
    updatedAt: z.iso.datetime(),
})
export type DiscountOutput = z.infer<typeof DiscountOutputSchema>

export const serializeDiscount = (
    row: DiscountDtoRow,
    stats: { uses: number; given: Array<{ currency: string; amount: number }> },
    today: string,
): DiscountOutput => {
    const rule = toDiscountRule({ ...row, plans: row.plans.map((p) => ({ planId: p.planId })) })
    return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        value: row.value,
        currency: row.currency,
        code: row.code,
        isFamily: row.isFamily,
        allPlans: row.allPlans,
        plans: row.allPlans
            ? []
            : row.plans
                  .map((p) => ({ id: p.planId, name: p.plan.name }))
                  .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        events: row.events,
        startsOn: row.startsOn ? dbDateToYmd(row.startsOn) : null,
        endsOn: row.endsOn ? dbDateToYmd(row.endsOn) : null,
        maxUses: row.maxUses,
        oncePerMember: row.oncePerMember,
        isActive: row.isActive,
        status: discountStatus(rule, stats.uses, today),
        uses: stats.uses,
        given: stats.given,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }
}

// The audit snapshot / diff fields of a discount.
export const discountAuditFields = (row: DiscountDtoRow) => ({
    name: row.name,
    kind: row.kind,
    value: row.value,
    currency: row.currency,
    code: row.code,
    isFamily: row.isFamily,
    allPlans: row.allPlans,
    plans: row.allPlans ? [] : row.plans.map((p) => p.plan.name).sort(),
    events: row.events,
    startsOn: row.startsOn ? dbDateToYmd(row.startsOn) : null,
    endsOn: row.endsOn ? dbDateToYmd(row.endsOn) : null,
    maxUses: row.maxUses,
    oncePerMember: row.oncePerMember,
    isActive: row.isActive,
})

// «Кто давал скидки»: one staff member's reductions in a currency over the
// period — one-off (typed amounts) and named (picked from the list).
export const DiscountStaffSummarySchema = z.object({
    userId: z.string().uuid(),
    name: z.string(),
    currency: z.string(),
    oneOff: z.object({ count: z.number().int(), amount: z.number().int() }),
    named: z.object({ count: z.number().int(), amount: z.number().int() }),
})
export type DiscountStaffSummary = z.infer<typeof DiscountStaffSummarySchema>
