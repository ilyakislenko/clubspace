jest.mock('../../environments/environment', () => ({
    environment: {
        adminEmail: 'admin@super.com',
        storeReview: { email: undefined, code: undefined },
    },
}))

import { environment } from '../../environments/environment'
import {
    isStoreReviewEmail,
    resolveStoreReview,
    storeReviewCodeMatches,
} from './store-review.util'

const admin = 'admin@super.com'

describe('resolveStoreReview', () => {
    it('is null when both are unset', () => {
        expect(resolveStoreReview({ adminEmail: admin })).toBeNull()
    })

    it('throws when only one is set', () => {
        expect(() =>
            resolveStoreReview({ email: 'r@b.com', adminEmail: admin }),
        ).toThrow(/together/)
        expect(() =>
            resolveStoreReview({ code: '482916', adminEmail: admin }),
        ).toThrow(/together/)
    })

    it.each(['48291', '4829167', 'abcdef', '48 916', '4829.6'])(
        'rejects non 6-digit code %s',
        (code) => {
            expect(() =>
                resolveStoreReview({ email: 'r@b.com', code, adminEmail: admin }),
            ).toThrow(/6 digits/)
        },
    )

    it.each(['000000', '111111', '123456', '234567', '654321', '987654'])(
        'rejects trivial code %s',
        (code) => {
            expect(() =>
                resolveStoreReview({ email: 'r@b.com', code, adminEmail: admin }),
            ).toThrow(/easy to guess/)
        },
    )

    it('rejects the super admin email, case-insensitively', () => {
        expect(() =>
            resolveStoreReview({
                email: 'Admin@Super.com',
                code: '482916',
                adminEmail: admin,
            }),
        ).toThrow(/SUPER_ADMIN_EMAIL/)
    })

    it('returns the normalized config when valid', () => {
        expect(
            resolveStoreReview({
                email: ' Review@B.com ',
                code: '482916',
                adminEmail: admin,
            }),
        ).toEqual({ email: 'review@b.com', code: '482916' })
    })
})

describe('isStoreReviewEmail / storeReviewCodeMatches', () => {
    afterEach(() => {
        environment.storeReview = { email: undefined, code: undefined }
    })

    it('are false when unconfigured', () => {
        expect(isStoreReviewEmail('review@b.com')).toBe(false)
        expect(storeReviewCodeMatches('482916')).toBe(false)
    })

    it('match trimmed, case-insensitive email and the exact code', () => {
        environment.storeReview = { email: 'review@b.com', code: '482916' }
        expect(isStoreReviewEmail('  REVIEW@b.com ')).toBe(true)
        expect(isStoreReviewEmail('other@b.com')).toBe(false)
        expect(storeReviewCodeMatches('482916')).toBe(true)
        expect(storeReviewCodeMatches('482917')).toBe(false)
        expect(storeReviewCodeMatches('48291')).toBe(false)
    })
})
