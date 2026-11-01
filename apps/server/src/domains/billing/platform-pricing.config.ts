// What a club pays ClubSpace: active-member tiers, paid modules, the annual
// discount and the setup fee. Pure and free of Nest/Prisma so the env merge is
// unit-tested directly (platform-pricing.config.spec.ts). Whole rubles, like
// Plan.price. Tiers are soft: the count only decides the price of the next
// charge, it never blocks adding anyone.

export type PlatformTier = {
    code: string
    name: string
    // Most active members the tier covers; null = the open-ended top tier.
    upTo: number | null
    priceMonthly: number
    // Per active member above the previous tier's upTo (the «Сеть» formula).
    extraMemberPrice: number
}

export const PLATFORM_MODULE_CODES = [
    'VIDEO',
    'ONLINE_PAYMENTS',
    'BRANDED_APP',
] as const
export type PlatformModuleCode = (typeof PLATFORM_MODULE_CODES)[number]

export type PlatformModulePricing = {
    code: PlatformModuleCode
    name: string
    priceMonthly: number
    // What the price includes, for the club's billing page.
    includes: string[]
    // Metered allowance and overage (only VIDEO uses them; 0 elsewhere).
    includedStorageGb: number
    includedViewHours: number
    extraStorageGbPrice: number
    extraViewHourPrice: number
}

export type PlatformPricing = {
    currency: string
    tiers: PlatformTier[]
    modules: PlatformModulePricing[]
    annualDiscountPercent: number
    setupFee: number
}

export const DEFAULT_PLATFORM_TIERS: PlatformTier[] = [
    { code: 'start', name: 'Старт', upTo: 50, priceMonthly: 2_990, extraMemberPrice: 0 },
    { code: 'club', name: 'Клуб', upTo: 100, priceMonthly: 5_990, extraMemberPrice: 0 },
    { code: 'pro', name: 'Про', upTo: 200, priceMonthly: 9_990, extraMemberPrice: 0 },
    { code: 'business', name: 'Бизнес', upTo: 400, priceMonthly: 16_990, extraMemberPrice: 0 },
    { code: 'network', name: 'Сеть', upTo: null, priceMonthly: 16_990, extraMemberPrice: 35 },
]

export const DEFAULT_PLATFORM_MODULES: PlatformModulePricing[] = [
    {
        code: 'VIDEO',
        name: 'Видео',
        priceMonthly: 990,
        includes: [
            'Видеотека и курсы для учеников',
            '20 ГБ хранилища',
            '100 часов просмотра в месяц',
        ],
        includedStorageGb: 20,
        includedViewHours: 100,
        extraStorageGbPrice: 10,
        extraViewHourPrice: 5,
    },
    {
        code: 'ONLINE_PAYMENTS',
        name: 'Онлайн-оплата',
        priceMonthly: 490,
        includes: [
            'Покупка абонементов в приложении',
            'Без процента с платежей',
        ],
        includedStorageGb: 0,
        includedViewHours: 0,
        extraStorageGbPrice: 0,
        extraViewHourPrice: 0,
    },
    {
        code: 'BRANDED_APP',
        name: 'Приложение под брендом клуба',
        priceMonthly: 2_990,
        includes: ['Своё название и иконка в App Store и Google Play'],
        includedStorageGb: 0,
        includedViewHours: 0,
        extraStorageGbPrice: 0,
        extraViewHourPrice: 0,
    },
]

const CODE_PATTERN = /^[a-z0-9_-]{1,32}$/

const parseArray = (raw: string, name: string): Record<string, unknown>[] => {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error(`${name} must be a JSON array`)
    }
    if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`)
    for (const entry of parsed) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            throw new Error(`${name} entries must be objects`)
        }
    }
    return parsed as Record<string, unknown>[]
}

const wholeRubles = (value: unknown, name: string, field: string, code: string) => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value
    }
    throw new Error(
        `${name}: "${field}" of "${code}" must be a non-negative integer`,
    )
}

const name = (value: unknown, env: string, code: string) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${env}: "name" of "${code}" must be a string`)
    }
    return value.trim()
}

// PLATFORM_PLANS: a JSON array of partial tiers keyed by `code` — a known code
// overrides only the fields it names, an unknown one adds a tier (and then
// needs name, upTo and priceMonthly). Tiers are re-sorted by upTo and must end
// with exactly one open-ended tier (upTo null). Malformed input throws so a
// typo stops the boot instead of mispricing every club.
export const resolvePlatformTiers = (
    raw: string | undefined,
    defaults: PlatformTier[] = DEFAULT_PLATFORM_TIERS,
): PlatformTier[] => {
    const env = 'PLATFORM_PLANS'
    const tiers = defaults.map((t) => ({ ...t }))
    if (raw && raw.trim()) {
        for (const o of parseArray(raw, env)) {
            const code = o.code
            if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
                throw new Error(
                    `${env}: every entry needs a "code" (a-z, 0-9, "-", "_")`,
                )
            }
            const patch: Partial<PlatformTier> = {}
            if (o.name !== undefined) patch.name = name(o.name, env, code)
            if (o.upTo !== undefined) {
                if (o.upTo === null) patch.upTo = null
                else {
                    const upTo = wholeRubles(o.upTo, env, 'upTo', code)
                    if (upTo < 1) {
                        throw new Error(`${env}: "upTo" of "${code}" must be at least 1`)
                    }
                    patch.upTo = upTo
                }
            }
            for (const field of ['priceMonthly', 'extraMemberPrice'] as const) {
                if (o[field] !== undefined) {
                    patch[field] = wholeRubles(o[field], env, field, code)
                }
            }
            const existing = tiers.find((t) => t.code === code)
            if (existing) {
                Object.assign(existing, patch)
                continue
            }
            if (
                patch.name === undefined ||
                patch.upTo === undefined ||
                patch.priceMonthly === undefined
            ) {
                throw new Error(
                    `${env}: new tier "${code}" needs "name", "upTo" and "priceMonthly"`,
                )
            }
            tiers.push({
                code,
                name: patch.name,
                upTo: patch.upTo,
                priceMonthly: patch.priceMonthly,
                extraMemberPrice: patch.extraMemberPrice ?? 0,
            })
        }
    }

    tiers.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
    const open = tiers.filter((t) => t.upTo === null)
    if (open.length !== 1) {
        throw new Error(`${env}: exactly one tier must have "upTo": null`)
    }
    for (let i = 1; i < tiers.length; i++) {
        const prev = tiers[i - 1].upTo
        const cur = tiers[i].upTo
        if (cur !== null && prev !== null && cur <= prev) {
            throw new Error(`${env}: two tiers share "upTo": ${cur}`)
        }
    }
    return tiers
}

// PLATFORM_MODULES: a JSON array of partial modules keyed by `code` (one of
// VIDEO / ONLINE_PAYMENTS / BRANDED_APP). Only known modules exist — they are
// enforced in code — so an unknown code throws.
export const resolvePlatformModules = (
    raw: string | undefined,
    defaults: PlatformModulePricing[] = DEFAULT_PLATFORM_MODULES,
): PlatformModulePricing[] => {
    const env = 'PLATFORM_MODULES'
    const modules = defaults.map((m) => ({ ...m, includes: [...m.includes] }))
    if (!raw || !raw.trim()) return modules
    for (const o of parseArray(raw, env)) {
        const existing = modules.find((m) => m.code === o.code)
        if (!existing) {
            throw new Error(
                `${env}: "code" must be one of ${PLATFORM_MODULE_CODES.join(', ')}`,
            )
        }
        const code = existing.code
        if (o.name !== undefined) existing.name = name(o.name, env, code)
        for (const field of [
            'priceMonthly',
            'includedStorageGb',
            'includedViewHours',
            'extraStorageGbPrice',
            'extraViewHourPrice',
        ] as const) {
            if (o[field] !== undefined) {
                existing[field] = wholeRubles(o[field], env, field, code)
            }
        }
        if (o.includes !== undefined) {
            if (
                !Array.isArray(o.includes) ||
                o.includes.some((f) => typeof f !== 'string')
            ) {
                throw new Error(`${env}: "includes" of "${code}" must be a string array`)
            }
            existing.includes = o.includes as string[]
        }
    }
    return modules
}

export const resolvePlatformPricing = (raw: {
    plans?: string
    modules?: string
    annualDiscountPercent: number
    setupFee: number
}): PlatformPricing => {
    if (
        !Number.isInteger(raw.annualDiscountPercent) ||
        raw.annualDiscountPercent < 0 ||
        raw.annualDiscountPercent > 100
    ) {
        throw new Error('PLATFORM_ANNUAL_DISCOUNT_PERCENT must be 0..100')
    }
    if (!Number.isInteger(raw.setupFee) || raw.setupFee < 0) {
        throw new Error('PLATFORM_SETUP_FEE must be a non-negative integer')
    }
    return {
        currency: 'RUB',
        tiers: resolvePlatformTiers(raw.plans),
        modules: resolvePlatformModules(raw.modules),
        annualDiscountPercent: raw.annualDiscountPercent,
        setupFee: raw.setupFee,
    }
}

// The tier `activeMembers` falls into and its monthly price: the first tier
// whose upTo covers the count, plus extraMemberPrice for every member above
// the previous tier's upTo (400 → «Бизнес» 16 990; 401 → «Сеть» 16 990 + 35).
export const tierFor = (
    tiers: PlatformTier[],
    activeMembers: number,
): { tier: PlatformTier; floor: number; extraMembers: number; monthly: number } => {
    const count = Math.max(0, Math.floor(activeMembers))
    let floor = 0
    for (const tier of tiers) {
        if (tier.upTo === null || count <= tier.upTo) {
            const extraMembers = Math.max(0, count - floor)
            return {
                tier,
                floor,
                extraMembers: tier.extraMemberPrice > 0 ? extraMembers : 0,
                monthly: tier.priceMonthly + tier.extraMemberPrice * extraMembers,
            }
        }
        floor = tier.upTo
    }
    // resolvePlatformTiers guarantees an open-ended last tier.
    throw new Error('platform tiers have no open-ended tier')
}

export const modulePricing = (
    pricing: PlatformPricing,
    code: PlatformModuleCode,
): PlatformModulePricing => {
    const found = pricing.modules.find((m) => m.code === code)
    if (!found) throw new Error(`platform module ${code} is not configured`)
    return found
}
