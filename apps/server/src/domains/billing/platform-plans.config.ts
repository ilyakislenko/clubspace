import type { PlanLimit } from '../../shared/errors/shared.errors'

// Platform tariffs (what a club pays ClubSpace) and the pure helpers around
// them. Kept free of Nest/Prisma so the merge, limit and lifecycle rules can be
// unit-tested directly (platform-plans.config.spec.ts).

export type PlatformPlanConfig = {
    code: string
    name: string
    // Whole currency units, like Plan.price. Display only — collection is
    // manual (the platform console marks a period paid).
    priceMonthly: number
    currency: string
    // null = unlimited.
    maxMembers: number | null
    maxCoaches: number | null
    maxStorageGb: number | null
    maxVideos: number | null
    features: string[]
    sortOrder: number
}

// Free → Club → Pro, as in the product tiers: a solo coach or a small gym, a
// club or a studio, a network of gyms.
export const DEFAULT_PLATFORM_PLANS: PlatformPlanConfig[] = [
    {
        code: 'free',
        name: 'Free',
        priceMonthly: 0,
        currency: 'RUB',
        maxMembers: 30,
        maxCoaches: 2,
        maxStorageGb: 2,
        maxVideos: 10,
        features: [
            'Расписание и группы',
            'Вступление по коду, QR и ссылке',
            'Отметка посещений',
            'Ранги и базовые абонементы',
            'Приложение для учеников и PWA',
        ],
        sortOrder: 0,
    },
    {
        code: 'club',
        name: 'Club',
        priceMonthly: 4_990,
        currency: 'RUB',
        maxMembers: 300,
        maxCoaches: 15,
        maxStorageGb: 100,
        maxVideos: null,
        features: [
            'Всё из Free',
            'Видеотека и курсы',
            'Заморозки и аттестации',
            'Отчёты: выручка, отток, загрузка',
            'Роли и права, импорт участников',
        ],
        sortOrder: 1,
    },
    {
        code: 'pro',
        name: 'Pro',
        priceMonthly: 14_990,
        currency: 'RUB',
        maxMembers: null,
        maxCoaches: null,
        maxStorageGb: 1000,
        maxVideos: null,
        features: [
            'Всё из Club',
            'Сеть залов и филиалы',
            'Безлимит участников и тренеров',
            'Приоритетная поддержка',
        ],
        sortOrder: 2,
    },
]

const PLAN_CODE_PATTERN = /^[a-z0-9_-]{1,32}$/

const optionalLimit = (value: unknown, field: string, code: string) => {
    if (value === undefined) return undefined
    if (value === null) return null
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value
    }
    throw new Error(
        `PLATFORM_PLANS: "${field}" of plan "${code}" must be a non-negative integer or null`,
    )
}

// PLATFORM_PLANS is a JSON array of partial plans keyed by `code`: a known code
// overrides only the fields it names, an unknown code adds a plan (and then
// needs a name). Unset or empty = the defaults. A malformed value throws so a
// typo stops the boot instead of silently pricing every club as Free.
export const resolvePlatformPlans = (
    raw: string | undefined,
    defaults: PlatformPlanConfig[] = DEFAULT_PLATFORM_PLANS,
): PlatformPlanConfig[] => {
    const plans = defaults.map((p) => ({ ...p, features: [...p.features] }))
    if (!raw || !raw.trim()) return plans

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error('PLATFORM_PLANS must be a JSON array')
    }
    if (!Array.isArray(parsed)) {
        throw new Error('PLATFORM_PLANS must be a JSON array')
    }

    for (const entry of parsed) {
        if (typeof entry !== 'object' || entry === null) {
            throw new Error('PLATFORM_PLANS entries must be objects')
        }
        const o = entry as Record<string, unknown>
        const code = o.code
        if (typeof code !== 'string' || !PLAN_CODE_PATTERN.test(code)) {
            throw new Error(
                'PLATFORM_PLANS: every entry needs a "code" (a-z, 0-9, "-", "_")',
            )
        }

        const patch: Partial<PlatformPlanConfig> = {}
        if (o.name !== undefined) {
            if (typeof o.name !== 'string' || !o.name.trim()) {
                throw new Error(`PLATFORM_PLANS: "name" of plan "${code}" must be a string`)
            }
            patch.name = o.name.trim()
        }
        if (o.priceMonthly !== undefined) {
            const price = optionalLimit(o.priceMonthly, 'priceMonthly', code)
            if (price === null || price === undefined) {
                throw new Error(`PLATFORM_PLANS: "priceMonthly" of plan "${code}" must be a number`)
            }
            patch.priceMonthly = price
        }
        if (o.currency !== undefined) {
            if (typeof o.currency !== 'string' || !/^[A-Z]{3}$/.test(o.currency)) {
                throw new Error(`PLATFORM_PLANS: "currency" of plan "${code}" must be ISO 4217`)
            }
            patch.currency = o.currency
        }
        for (const field of [
            'maxMembers',
            'maxCoaches',
            'maxStorageGb',
            'maxVideos',
            'sortOrder',
        ] as const) {
            const v = optionalLimit(o[field], field, code)
            if (v === undefined) continue
            if (field === 'sortOrder') {
                if (v === null) {
                    throw new Error(`PLATFORM_PLANS: "sortOrder" of plan "${code}" must be a number`)
                }
                patch.sortOrder = v
            } else {
                patch[field] = v
            }
        }
        if (o.features !== undefined) {
            if (
                !Array.isArray(o.features) ||
                o.features.some((f) => typeof f !== 'string')
            ) {
                throw new Error(`PLATFORM_PLANS: "features" of plan "${code}" must be a string array`)
            }
            patch.features = o.features as string[]
        }

        const existing = plans.find((p) => p.code === code)
        if (existing) {
            Object.assign(existing, patch)
            continue
        }
        if (!patch.name) {
            throw new Error(`PLATFORM_PLANS: new plan "${code}" needs a "name"`)
        }
        plans.push({
            code,
            name: patch.name,
            priceMonthly: patch.priceMonthly ?? 0,
            currency: patch.currency ?? 'RUB',
            maxMembers: patch.maxMembers ?? null,
            maxCoaches: patch.maxCoaches ?? null,
            maxStorageGb: patch.maxStorageGb ?? null,
            maxVideos: patch.maxVideos ?? null,
            features: patch.features ?? [],
            sortOrder: patch.sortOrder ?? plans.length,
        })
    }

    return plans
}

export const BYTES_PER_GB = 1024 ** 3

export type PlanLimits = {
    maxMembers: number | null
    maxCoaches: number | null
    maxStorageGb: number | null
    maxVideos: number | null
}

export type WorkspaceUsage = {
    members: number
    coaches: number
    storageBytes: number
    videos: number
}

// The limit and the current use of one dimension, in the same unit (storage in
// bytes). max = null means unlimited.
export const limitFor = (
    plan: PlanLimits,
    usage: WorkspaceUsage,
    key: PlanLimit,
): { max: number | null; used: number } => {
    switch (key) {
        case 'members':
            return { max: plan.maxMembers, used: usage.members }
        case 'coaches':
            return { max: plan.maxCoaches, used: usage.coaches }
        case 'videos':
            return { max: plan.maxVideos, used: usage.videos }
        case 'storage':
            return {
                max:
                    plan.maxStorageGb === null
                        ? null
                        : plan.maxStorageGb * BYTES_PER_GB,
                used: usage.storageBytes,
            }
    }
}

// How many more units fit; null = unlimited. Never negative: a club that is
// already over (downgraded, or limits lowered) simply has no room.
export const remainingCapacity = (
    plan: PlanLimits,
    usage: WorkspaceUsage,
    key: PlanLimit,
): number | null => {
    const { max, used } = limitFor(plan, usage, key)
    if (max === null) return null
    return Math.max(0, max - used)
}

export type BillingStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED'

const DAY_MS = 24 * 60 * 60 * 1000

export const addDays = (from: Date, days: number): Date =>
    new Date(from.getTime() + days * DAY_MS)

// The automatic lifecycle, one step per call. A trial that ended, or a paid
// period that ran out on a paid plan, goes PAST_DUE (dated from when it ran
// out); PAST_DUE turns SUSPENDED once the grace period has passed. Everything
// else stays put — ACTIVE without a period end never expires, and SUSPENDED
// only changes by hand in the platform console.
export const nextBillingTransition = (
    row: {
        status: BillingStatus
        trialEndsAt: Date | null
        currentPeriodEnd: Date | null
        pastDueSince: Date | null
        priceMonthly: number
    },
    now: Date,
    graceDays: number,
): { status: 'PAST_DUE'; pastDueSince: Date } | { status: 'SUSPENDED' } | null => {
    if (row.status === 'TRIAL') {
        if (row.trialEndsAt && row.trialEndsAt <= now) {
            return { status: 'PAST_DUE', pastDueSince: row.trialEndsAt }
        }
        return null
    }
    if (row.status === 'ACTIVE') {
        if (
            row.priceMonthly > 0 &&
            row.currentPeriodEnd &&
            row.currentPeriodEnd <= now
        ) {
            return { status: 'PAST_DUE', pastDueSince: row.currentPeriodEnd }
        }
        return null
    }
    if (row.status === 'PAST_DUE') {
        const since = row.pastDueSince ?? now
        if (addDays(since, graceDays) <= now) return { status: 'SUSPENDED' }
        return null
    }
    return null
}

// Why a club is closed to its members, or null when it is open. A platform
// switch-off (isActive = false) always applies; a billing suspension only
// while billing is enabled — a self-hosted install never locks a club out.
export const suspensionReason = (
    workspace: {
        isActive: boolean
        billing: { status: BillingStatus } | null
    },
    billingEnabled: boolean,
): 'INACTIVE' | 'SUSPENDED' | null => {
    if (!workspace.isActive) return 'INACTIVE'
    if (billingEnabled && workspace.billing?.status === 'SUSPENDED') {
        return 'SUSPENDED'
    }
    return null
}
