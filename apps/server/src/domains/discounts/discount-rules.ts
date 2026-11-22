// The price rule of a sale (docs/design/2026-11-15-discounts.md §1, §3.1):
// pure functions shared by the staff sale writers, the online checkout and
// autopay. The server prices; clients never re-implement this.
import { dbDateToYmd } from '../subscriptions/freeze-dates'

export type DiscountKindValue = 'PERCENT' | 'FIXED'

// A discount as the rules read it (domains/discounts/discount-store.ts loads it).
export type DiscountRule = {
    id: string
    name: string
    kind: DiscountKindValue
    value: number
    // FIXED only.
    currency: string | null
    code: string | null
    isFamily: boolean
    allPlans: boolean
    planIds: readonly string[]
    events: boolean
    // Club-local days (@db.Date, UTC midnight), inclusive; null = open.
    startsOn: Date | null
    endsOn: Date | null
    maxUses: number | null
    oncePerMember: boolean
    isActive: boolean
}

// What is being sold: a tariff (planId) or an event ticket (eventId).
export type SaleItem = {
    planId: string | null
    eventId: string | null
    listPrice: number
    currency: string
}

export type PricedSale = {
    // What the member pays: listPrice − discountAmount.
    amount: number
    // The named discount's part (0 without one).
    discountAmount: number
    discountId: string | null
    discountName: string | null
}

const PROMO_CODE_PATTERN = /^[A-ZА-Я0-9-]{3,32}$/

// Trim, upper-case, Ё→Е; null unless it is 3–32 of А–Я, A–Z, 0–9 or «-».
export const normalizePromoCode = (raw: string): string | null => {
    const code = raw.trim().toUpperCase().replace(/Ё/g, 'Е')
    return PROMO_CODE_PATTERN.test(code) ? code : null
}

// Half-up rounding of a non-negative amount to whole units.
const roundHalfUp = (n: number): number => Math.floor(n + 0.5)

// §1: PERCENT = round_half_up(listPrice × value / 100); FIXED = min(value,
// listPrice); never on a 0 price. Callers check discountApplies first.
export const priceSale = (p: {
    listPrice: number
    currency: string
    discount: Pick<DiscountRule, 'id' | 'name' | 'kind' | 'value' | 'currency'> | null
}): PricedSale => {
    const d = p.discount
    if (!d || p.listPrice <= 0) {
        return { amount: p.listPrice, discountAmount: 0, discountId: null, discountName: null }
    }
    const raw =
        d.kind === 'PERCENT'
            ? roundHalfUp((p.listPrice * d.value) / 100)
            : d.currency === p.currency
              ? d.value
              : 0
    const discountAmount = Math.max(0, Math.min(raw, p.listPrice))
    return {
        amount: p.listPrice - discountAmount,
        discountAmount,
        discountId: d.id,
        discountName: d.name,
    }
}

export type DiscountRefusalReason =
    | 'archived'
    | 'expired'
    | 'scheduled'
    | 'scope'
    | 'currency'
    | 'free'

// Why a discount can't price an item. `reason` lets the online checkout word
// its own note («Срок действия промокода закончился»); `message` is the staff
// sale's 400 text.
export type DiscountRefusal = { reason: DiscountRefusalReason; message: string }

// Checks, in order: active, dates (club-local `today`, YYYY-MM-DD), scope,
// currency, list price > 0. Limits (uses) and the family condition are
// checked by the callers (discount-uses.ts, family.ts).
export const discountApplies = (
    d: DiscountRule,
    item: SaleItem,
    today: string,
): DiscountRefusal | null => {
    const what = item.eventId ? 'это событие' : 'этот тариф'
    if (!d.isActive) {
        return { reason: 'archived', message: `Скидка «${d.name}» в архиве` }
    }
    if (d.endsOn && dbDateToYmd(d.endsOn) < today) {
        return { reason: 'expired', message: `Срок скидки «${d.name}» закончился` }
    }
    if (d.startsOn && dbDateToYmd(d.startsOn) > today) {
        return { reason: 'scheduled', message: `Срок скидки «${d.name}» ещё не начался` }
    }
    const inScope = item.eventId
        ? d.events
        : item.planId !== null && (d.allPlans || d.planIds.includes(item.planId))
    if (!inScope) {
        return { reason: 'scope', message: `Скидка «${d.name}» не действует на ${what}` }
    }
    if (d.kind === 'FIXED' && d.currency !== item.currency) {
        return {
            reason: 'currency',
            message: `Скидка «${d.name}» указана в другой валюте и не действует на ${what}`,
        }
    }
    if (item.listPrice <= 0) {
        return {
            reason: 'free',
            message: `Скидка «${d.name}» не действует на ${item.eventId ? 'бесплатное событие' : 'бесплатный тариф'}`,
        }
    }
    return null
}

// §1 for readers: the total discount of a sale = max(0, listPrice − amount);
// the named part is discountAmount (never more than the total), the rest a
// one-off reduction. A sale without a recorded list price shows none.
export const saleDiscount = (row: {
    listPrice: number | null
    amountPaid: number | null
    discountAmount: number
}): { total: number; named: number; oneOff: number } => {
    if (row.listPrice === null) return { total: 0, named: 0, oneOff: 0 }
    const total = Math.max(0, row.listPrice - (row.amountPaid ?? 0))
    const named = Math.min(row.discountAmount, total)
    return { total, named, oneOff: total - named }
}

export type DiscountStatusValue = 'active' | 'scheduled' | 'expired' | 'exhausted' | 'archived'

export const discountStatus = (
    d: Pick<DiscountRule, 'isActive' | 'startsOn' | 'endsOn' | 'maxUses'>,
    uses: number,
    today: string,
): DiscountStatusValue => {
    if (!d.isActive) return 'archived'
    if (d.endsOn && dbDateToYmd(d.endsOn) < today) return 'expired'
    if (d.startsOn && dbDateToYmd(d.startsOn) > today) return 'scheduled'
    if (d.maxUses !== null && uses >= d.maxUses) return 'exhausted'
    return 'active'
}
