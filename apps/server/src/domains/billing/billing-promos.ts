import { discountPercentAt } from './billing-rules'
import type { PlatformModuleCode } from './platform-pricing.config'

// The promos running for a club right now, as the club's «Тариф» page and the
// platform console list them: a free subscription period, a discount (with
// its end date, if any), a paid module granted free until a date, the setup
// fee waived before the first payment. Pure (billing-promos.spec.ts).

export const BILLING_PROMO_KINDS = [
    'FREE_PERIOD',
    'DISCOUNT',
    'MODULE_GIFT',
    'SETUP_FEE_WAIVED',
] as const

export type BillingPromoKind = (typeof BILLING_PROMO_KINDS)[number]

export type BillingPromo = {
    kind: BillingPromoKind
    title: string
    // When it ends; null = until the platform lifts it.
    until: Date | null
}

export type PromoBillingRow = {
    freeUntil: Date | null
    discountPercent: number
    discountUntil?: Date | null
    setupFeeWaived: boolean
    setupFeePaidAt: Date | null
}

export type PromoModuleRow = {
    module: PlatformModuleCode
    mode: string | null
    compUntil: Date | null
}

export const activePromos = (
    row: PromoBillingRow,
    modules: PromoModuleRow[],
    moduleName: (code: PlatformModuleCode) => string,
    now: Date,
): BillingPromo[] => {
    const promos: BillingPromo[] = []
    if (row.freeUntil && row.freeUntil > now) {
        promos.push({
            kind: 'FREE_PERIOD',
            title: 'Подписка бесплатно',
            until: row.freeUntil,
        })
    }
    const percent = discountPercentAt(row, now)
    if (percent > 0) {
        promos.push({
            kind: 'DISCOUNT',
            title: `Скидка ${percent}% на подписку и модули`,
            until: row.discountUntil ?? null,
        })
    }
    for (const m of modules) {
        if (m.mode === 'COMP' && m.compUntil && m.compUntil > now) {
            promos.push({
                kind: 'MODULE_GIFT',
                title: `Модуль «${moduleName(m.module)}» в подарок`,
                until: m.compUntil,
            })
        }
    }
    if (row.setupFeeWaived && !row.setupFeePaidAt) {
        promos.push({
            kind: 'SETUP_FEE_WAIVED',
            title: 'Подключение без оплаты',
            until: null,
        })
    }
    return promos
}
