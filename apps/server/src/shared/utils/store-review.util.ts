import { timingSafeEqual } from 'crypto'

import { environment } from '../../environments/environment'

type StoreReviewEnv = {
    email?: string
    code?: string
    adminEmail: string
}

export type StoreReviewConfig = { email: string; code: string }

const normalize = (email: string) => email.trim().toLowerCase()

// A fixed code is a standing credential, so refuse the ones that are
// guessable in a handful of tries: all one digit, or a straight run.
const isTrivialCode = (code: string): boolean => {
    const digits = code.split('').map(Number)
    const steps = digits.slice(1).map((d, i) => d - digits[i])
    const sameDigit = steps.every((s) => s === 0)
    const ascending = steps.every((s) => s === 1)
    const descending = steps.every((s) => s === -1)
    return sameDigit || ascending || descending
}

// Validates the opt-in store-review account. Returns null when unconfigured;
// throws (so the server refuses to boot) on any half-set or weak config.
export const resolveStoreReview = (
    env: StoreReviewEnv,
): StoreReviewConfig | null => {
    const email = env.email?.trim()
    const code = env.code

    if (!email && !code) return null

    if (!email || !code) {
        throw new Error(
            '[startup] STORE_REVIEW_EMAIL and STORE_REVIEW_CODE must be set together',
        )
    }
    if (!/^\d{6}$/.test(code)) {
        throw new Error('[startup] STORE_REVIEW_CODE must be exactly 6 digits')
    }
    if (isTrivialCode(code)) {
        throw new Error(
            '[startup] STORE_REVIEW_CODE is too easy to guess (repeated digit or straight run)',
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
