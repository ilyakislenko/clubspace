import {
    addDays,
    addMonths,
    type BillingStatus,
    endOfDayMoscow,
    paidPeriodStart,
} from '../../domains/billing/billing-rules'
import type { ModuleMode } from '../../domains/billing/module-entitlement'
import type { PlatformModuleCode } from '../../domains/billing/platform-pricing.config'

// DD.MM.YYYY in Moscow, as the console shows dates.
const DAY = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
})

type CurrentBilling = {
    status: BillingStatus
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    setupFeePaidAt: Date | null
    // Optional so fixtures that predate it stay valid.
    convertedAt?: Date | null
}

export type BillingPatch = {
    status?: BillingStatus
    trialEndsAt?: Date
    currentPeriodEnd?: Date | null
    pastDueSince?: null
    freeUntil?: Date | null
    setupFeePaidAt?: Date
    paidTierCode?: string
    convertedAt?: Date
    suspendedAt?: Date
    archivedAt?: null
}

const laterOf = (a: Date, b: Date | null): Date =>
    b && b > a ? b : a

// What a status action from the platform console writes. Pure, so the date
// arithmetic is tested on its own (platform-billing-utils.spec.ts).
//  - extendTrial: back to TRIAL, `days` past the later of now and the current
//    trial end (extending an expired trial starts from today).
//  - markPaid: ACTIVE, `days` past the later of now and the current period
//    end (paying early never loses paid days); the first payment also covers
//    the setup fee, marks the trial converted, and records the tier it paid for.
//  - extendPeriod: the same dates as markPaid, without recording a payment
//    (a goodwill extension).
//  - suspend: SUSPENDED, dates untouched; the archive countdown starts.
//  - resume: ACTIVE. A period end already in the past is cleared, otherwise
//    the daily pass would suspend the club again that night; the operator
//    marks a paid period to start counting again.
export const billingStatusPatch = (
    kind: 'extendTrial' | 'markPaid' | 'extendPeriod' | 'suspend' | 'resume',
    current: CurrentBilling,
    now: Date,
    days = 0,
    tierCode = '',
): BillingPatch => {
    switch (kind) {
        case 'extendTrial':
            return {
                status: 'TRIAL',
                trialEndsAt: addDays(laterOf(now, current.trialEndsAt), days),
                pastDueSince: null,
            }
        case 'markPaid':
            return {
                status: 'ACTIVE',
                currentPeriodEnd: addDays(
                    laterOf(now, current.currentPeriodEnd),
                    days,
                ),
                pastDueSince: null,
                paidTierCode: tierCode,
                ...(current.setupFeePaidAt ? {} : { setupFeePaidAt: now }),
                ...(current.convertedAt ? {} : { convertedAt: now }),
            }
        case 'extendPeriod':
            return {
                status: 'ACTIVE',
                currentPeriodEnd: addDays(
                    laterOf(now, current.currentPeriodEnd),
                    days,
                ),
                pastDueSince: null,
            }
        case 'suspend':
            return { status: 'SUSPENDED', suspendedAt: now, archivedAt: null }
        case 'resume':
            return {
                status: 'ACTIVE',
                pastDueSince: null,
                ...(current.currentPeriodEnd && current.currentPeriodEnd <= now
                    ? { currentPeriodEnd: null }
                    : {}),
            }
    }
}

// «Пару месяцев бесплатно»: the whole subscription is free through `ymd`
// (inclusive, Moscow), or the promo is cleared with null. A free period
// reaching past now also lifts an overdue club back to ACTIVE and moves its
// next charge to the end of the free period; a trial keeps running and turns
// ACTIVE through the free period when it ends (nextBillingTransition); a
// suspended club stays suspended until the operator resumes it.
export const freeUntilPatch = (
    ymd: string | null,
    current: CurrentBilling,
    now: Date,
): BillingPatch =>
    ymd === null
        ? { freeUntil: null }
        : freeUntilPatchAt(endOfDayMoscow(ymd), current, now)

// The same as freeUntilPatch for an exact moment (the promo presets).
const freeUntilPatchAt = (
    freeUntil: Date,
    current: CurrentBilling,
    now: Date,
): BillingPatch => {
    if (freeUntil <= now) return { freeUntil }
    if (current.status === 'PAST_DUE') {
        return {
            freeUntil,
            status: 'ACTIVE',
            pastDueSince: null,
            currentPeriodEnd: laterOf(freeUntil, current.currentPeriodEnd),
        }
    }
    if (current.status === 'ACTIVE' && current.currentPeriodEnd) {
        return {
            freeUntil,
            currentPeriodEnd: laterOf(freeUntil, current.currentPeriodEnd),
        }
    }
    return { freeUntil }
}

export const PROMO_PRESETS = [
    'FREE_MONTHS',
    'VIDEO_GIFT',
    'DISCOUNT',
    'NO_SETUP_FEE',
] as const

export type PromoPreset = (typeof PROMO_PRESETS)[number]

export type PromoPresetInput = {
    preset: PromoPreset
    months?: number
    discountPercent?: number
}

type PromoBilling = CurrentBilling & {
    freeUntil: Date | null
}

type PromoModule = {
    module: PlatformModuleCode
    mode: ModuleMode
    compUntil: Date | null
}

// What one console promo preset writes — the existing overrides, nothing
// new — and the line the journal and the confirmation show. Pure.
//  - FREE_MONTHS: the subscription is free for `months` from where the club's
//    next paid period would start (after the trial / the paid period / an
//    earlier free period; now for an overdue club), so «1 месяц бесплатно»
//    is one whole month that would otherwise have been charged.
//  - VIDEO_GIFT: VIDEO granted free (COMP) for `months` from now, or from the
//    end of a gift still running; then it switches off like any comp.
//  - DISCOUNT: `discountPercent` off the recurring lines for `months` from
//    the same start as FREE_MONTHS; the quote stops applying it at
//    discountUntil.
//  - NO_SETUP_FEE: the one-time setup fee is waived.
export const promoPresetPlan = (
    input: PromoPresetInput,
    current: PromoBilling,
    video: PromoModule | null,
    now: Date,
): {
    billing: BillingPatch & {
        discountPercent?: number
        discountUntil?: Date
        setupFeeWaived?: boolean
    }
    module: (PromoModule & { customPrice: null; cancelAt: null }) | null
    summary: string
} => {
    const months = Math.max(1, Math.floor(input.months ?? 1))
    const start = paidPeriodStart(current, now)
    switch (input.preset) {
        case 'FREE_MONTHS': {
            const freeUntil = addMonths(start, months)
            return {
                billing: freeUntilPatchAt(freeUntil, current, now),
                module: null,
                summary: `${months} мес. бесплатно — до ${DAY.format(freeUntil)}`,
            }
        }
        case 'VIDEO_GIFT': {
            const running =
                video?.mode === 'COMP' && video.compUntil && video.compUntil > now
                    ? video.compUntil
                    : now
            const compUntil = addMonths(running, months)
            return {
                billing: {},
                module: {
                    module: 'VIDEO',
                    mode: 'COMP',
                    compUntil,
                    customPrice: null,
                    cancelAt: null,
                },
                summary: `Видео в подарок на ${months} мес. — до ${DAY.format(compUntil)}`,
            }
        }
        case 'DISCOUNT': {
            const percent = input.discountPercent ?? 0
            const discountUntil = addMonths(start, months)
            return {
                billing: { discountPercent: percent, discountUntil },
                module: null,
                summary: `Скидка ${percent}% на ${months} мес. — до ${DAY.format(discountUntil)}`,
            }
        }
        case 'NO_SETUP_FEE':
            return {
                billing: { setupFeeWaived: true },
                module: null,
                summary: 'Без платы за подключение',
            }
    }
}
