import { timingSafeEqual } from 'crypto'

import { environment } from '../../environments/environment'

type StoreReviewEnv = {
    email?: string
    code?: string
    workspaceKey?: string
    adminEmail: string
}

export type StoreReviewConfig = { email: string; code: string }

const normalize = (email: string) => email.trim().toLowerCase()

// The placeholder-looking code that used to ship in the public examples, plus
// keypad patterns that are cheap to guess.
const DENIED_CODES = new Set([
    '482916',
    '147258',
    '258369',
    '369258',
    '741852',
    '852963',
    '963852',
    '159357',
    '147369',
    '789456',
    '456789',
])

// A fixed code is a standing credential, so refuse the ones that are
// guessable in a handful of tries.
const isTrivialCode = (code: string): boolean => {
    if (DENIED_CODES.has(code)) return true
    const digits = code.split('').map(Number)
    // At most two distinct digits (111111, 121212, 112211, ...).
    if (new Set(digits).size <= 2) return true
    // Straight runs, including the 9 -> 0 wrap (123456, 654321, 890123).
    const steps = digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10)
    if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return true
    // A 2- or 3-digit block repeated (123123, 454545).
    for (const period of [2, 3]) {
        if (digits.every((d, i) => d === digits[i % period])) return true
    }
    // Doubled digits (112233).
    if (
        digits[0] === digits[1] &&
        digits[2] === digits[3] &&
        digits[4] === digits[5]
    ) {
        return true
    }
    return false
}

// Validates the opt-in store-review account. Returns null when unconfigured;
// throws (so the server refuses to boot) on any half-set or weak config.
export const resolveStoreReview = (
    env: StoreReviewEnv,
): StoreReviewConfig | null => {
    const email = env.email?.trim()
    const code = env.code

    // A demo club for a reviewer who can never sign in is a config mistake.
    if (env.workspaceKey?.trim() && (!email || !code)) {
        throw new Error(
            '[startup] STORE_REVIEW_WORKSPACE_KEY needs STORE_REVIEW_EMAIL and STORE_REVIEW_CODE',
        )
    }

    if (!email && !code) return null

    if (!email || !code) {
        throw new Error(
            '[startup] STORE_REVIEW_EMAIL and STORE_REVIEW_CODE must be set together',
        )
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('[startup] STORE_REVIEW_EMAIL is not a valid email')
    }
    if (!/^\d{6}$/.test(code)) {
        throw new Error('[startup] STORE_REVIEW_CODE must be exactly 6 digits')
    }
    if (isTrivialCode(code)) {
        throw new Error(
            '[startup] STORE_REVIEW_CODE is too easy to guess (repeated digits, a straight run or a known pattern)',
        )
    }
    if (normalize(email) === normalize(env.adminEmail)) {
        throw new Error(
            '[startup] STORE_REVIEW_EMAIL must not be the SUPER_ADMIN_EMAIL',
        )
    }

    return { email: normalize(email), code }
}

const current = () =>
    resolveStoreReview({
        email: environment.storeReview.email,
        code: environment.storeReview.code,
        adminEmail: environment.adminEmail,
    })

export const isStoreReviewEmail = (email: string): boolean => {
    const config = current()
    return config !== null && config.email === normalize(email)
}

// Constant-time: a plain `===` leaks how many leading digits matched.
export const storeReviewCodeMatches = (code: string): boolean => {
    const config = current()
    if (!config) return false
    const aBuf = Buffer.from(code)
    const bBuf = Buffer.from(config.code)
    if (aBuf.length !== bBuf.length) return false
    return timingSafeEqual(aBuf, bBuf)
}
