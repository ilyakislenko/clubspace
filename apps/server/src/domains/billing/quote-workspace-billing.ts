import { addMonths, BYTES_PER_GB } from './billing-rules'
import type { ModuleMode } from './module-entitlement'
import {
    modulePricing,
    PLATFORM_MODULE_CODES,
    type PlatformModuleCode,
    type PlatformPricing,
    tierFor,
} from './platform-pricing.config'

// The one place a ClubSpace charge is computed. Pure: the caller loads the
// facts (PlatformBillingService.quoteWorkspaceBilling does it for a club) and
// the autopay slice charges exactly `total`. Whole rubles throughout.
//
// Rules, in order:
//  1. Subscription: the tier for the active-member count (or the platform's
//     custom monthly price) × periodMonths.
//  2. Modules: PAID ones at their price (or a custom one) × periodMonths; a
//     COMP that is still running shows at 0; OFF / not bought / an expired
//     comp is not on the bill (the module switches off).
//  3. A subscription free period (freeUntil) zeroes the part of the period it
//     covers on the lines of 1 and 2, pro rata by time.
//  4. VIDEO overage (only when VIDEO is on the bill): extra GB stored over the
//     allowance and extra viewing hours of the metered month, each started
//     unit counted, charged once (not × periodMonths), never discounted.
//  6. Discounts on the recurring lines (1 + 2) only: the annual prepay
//     discount for a 12-month period, then the platform's discount % on what
//     remains — for the part of the period before discountUntil when the
//     discount has an end date (pro rata by time). Each rounded to whole
//     rubles.

export type QuoteLine = { code: string; title: string; amount: number }

export type WorkspaceQuote = {
    lines: QuoteLine[]
    subtotal: number
    // Sum of `discounts`; total = subtotal - discount.
    discount: number
    discounts: QuoteLine[]
    total: number
    currency: string
    periodMonths: number
    // The tier the active-member count fell into (recorded with a payment).
    tierCode: string
}

export type QuoteModuleInput = {
    code: PlatformModuleCode
    mode: ModuleMode | null
    compUntil: Date | null
    customPrice: number | null
    // PAID disconnected by the club: off the bill for a period starting at
    // or after this moment.
    cancelAt?: Date | null
}

export type QuoteInputs = {
    pricing: PlatformPricing
    activeMembers: number
    // The period being charged: [periodStart, periodStart + periodMonths).
    periodStart: Date
    periodMonths: number
    subscription: {
        customMonthlyPrice: number | null
        discountPercent: number
        // The discount ends at this moment; null/absent = no end.
        discountUntil?: Date | null
        freeUntil: Date | null
    }
    setupFee: { waived: boolean; paid: boolean }
    modules: QuoteModuleInput[]
    usage: { storageBytes: number; viewedSeconds: number }
}

const RUB = new Intl.NumberFormat('ru-RU')
const DATE = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
})

const monthsSuffix = (months: number) => (months > 1 ? ` × ${months} мес.` : '')

export const quoteWorkspaceBilling = (input: QuoteInputs): WorkspaceQuote => {
    const { pricing, periodStart, subscription } = input
    const months = Math.max(1, Math.floor(input.periodMonths))
    const periodEnd = addMonths(periodStart, months)
    const periodMs = periodEnd.getTime() - periodStart.getTime()

    // Share of the period still to pay after a free period ending at `until`.
    const payableShare = (until: Date | null): number => {
        if (!until || until <= periodStart) return 1
        if (until >= periodEnd) return 0
        return (periodEnd.getTime() - until.getTime()) / periodMs
    }
    const freeShare = payableShare(subscription.freeUntil)
    const freeNote =
        subscription.freeUntil && freeShare < 1
            ? freeShare === 0
                ? ` — бесплатно до ${DATE.format(subscription.freeUntil)}`
                : ` — с учётом бесплатного периода до ${DATE.format(subscription.freeUntil)}`
            : ''

    const recurring: QuoteLine[] = []
    const lines: QuoteLine[] = []

    // 1. Subscription.
    const tier = tierFor(pricing.tiers, input.activeMembers)
    const tierLabel =
        tier.tier.upTo === null
            ? `Тариф «${tier.tier.name}» — ${input.activeMembers} активных` +
              (tier.extraMembers > 0
                  ? ` (${RUB.format(tier.tier.priceMonthly)} ₽ + ${RUB.format(tier.tier.extraMemberPrice)} ₽ × ${tier.extraMembers} сверх ${tier.floor})`
                  : '')
            : `Тариф «${tier.tier.name}» — до ${tier.tier.upTo} активных`
    const custom = subscription.customMonthlyPrice
    recurring.push(
        custom !== null
            ? {
                  code: 'subscription',
                  title: `Подписка по индивидуальной цене — ${input.activeMembers} активных${monthsSuffix(months)}${freeNote}`,
                  amount: Math.round(custom * months * freeShare),
              }
            : {
                  code: 'tier',
                  title: `${tierLabel}${monthsSuffix(months)}${freeNote}`,
                  amount: Math.round(tier.monthly * months * freeShare),
              },
    )

    // 2. Modules, in their canonical order.
    let videoOnBill = false
    for (const code of PLATFORM_MODULE_CODES) {
        const m = input.modules.find((x) => x.code === code)
        if (!m) continue
        const config = modulePricing(pricing, code)
        if (m.mode === 'PAID' && (!m.cancelAt || m.cancelAt > periodStart)) {
            recurring.push({
                code: `module:${code}`,
                title: `Модуль «${config.name}»${monthsSuffix(months)}${freeNote}`,
                amount: Math.round(
                    (m.customPrice ?? config.priceMonthly) * months * freeShare,
                ),
            })
        } else if (m.mode === 'COMP' && m.compUntil && m.compUntil > periodStart) {
            recurring.push({
                code: `module:${code}`,
                title: `Модуль «${config.name}» — бесплатно до ${DATE.format(m.compUntil)}`,
                amount: 0,
            })
        } else {
            continue
        }
        if (code === 'VIDEO') videoOnBill = true
    }
    lines.push(...recurring)

    // 4. VIDEO overage.
    if (videoOnBill) {
        const video = modulePricing(pricing, 'VIDEO')
        const extraBytes =
            input.usage.storageBytes - video.includedStorageGb * BYTES_PER_GB
        const extraGb = extraBytes > 0 ? Math.ceil(extraBytes / BYTES_PER_GB) : 0
        if (extraGb > 0 && video.extraStorageGbPrice > 0) {
            lines.push({
                code: 'overage:storage',
                title: `Хранилище сверх ${video.includedStorageGb} ГБ: ${extraGb} ГБ × ${RUB.format(video.extraStorageGbPrice)} ₽`,
                amount: extraGb * video.extraStorageGbPrice,
            })
        }
        const extraSeconds = input.usage.viewedSeconds - video.includedViewHours * 3600
        const extraHours = extraSeconds > 0 ? Math.ceil(extraSeconds / 3600) : 0
        if (extraHours > 0 && video.extraViewHourPrice > 0) {
            lines.push({
                code: 'overage:viewing',
                title: `Просмотр сверх ${video.includedViewHours} ч: ${extraHours} ч × ${RUB.format(video.extraViewHourPrice)} ₽`,
                amount: extraHours * video.extraViewHourPrice,
            })
        }
    }

    // 5. Setup fee.
    if (!input.setupFee.waived && !input.setupFee.paid && pricing.setupFee > 0) {
        lines.push({
            code: 'setup',
            title: 'Подключение (разово)',
            amount: pricing.setupFee,
        })
    }

    // 6. Discounts on the recurring part.
    const recurringSum = recurring.reduce((sum, l) => sum + l.amount, 0)
    const discounts: QuoteLine[] = []
    let annual = 0
    if (months === 12 && pricing.annualDiscountPercent > 0 && recurringSum > 0) {
        annual = Math.round((recurringSum * pricing.annualDiscountPercent) / 100)
        discounts.push({
            code: 'annual',
            title: `Оплата за год −${pricing.annualDiscountPercent}%`,
            amount: annual,
        })
    }
    const percent = Math.min(100, Math.max(0, subscription.discountPercent))
    const discountUntil = subscription.discountUntil ?? null
    // Share of the period the discount still covers.
    const discountShare = !discountUntil
        ? 1
        : discountUntil <= periodStart
          ? 0
          : discountUntil >= periodEnd
            ? 1
            : (discountUntil.getTime() - periodStart.getTime()) / periodMs
    if (percent > 0 && discountShare > 0 && recurringSum - annual > 0) {
        discounts.push({
            code: 'platform',
            title: discountUntil
                ? `Скидка ${percent}% до ${DATE.format(discountUntil)}`
                : `Скидка ${percent}%`,
            amount: Math.round(
                ((recurringSum - annual) * percent * discountShare) / 100,
            ),
        })
    }

    const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
    const discount = discounts.reduce((sum, l) => sum + l.amount, 0)
    return {
        lines,
        subtotal,
        discount,
        discounts,
        total: subtotal - discount,
        currency: pricing.currency,
        periodMonths: months,
        tierCode: tier.tier.code,
    }
}
