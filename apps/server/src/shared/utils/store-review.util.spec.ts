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
            resolveStoreReview({ code: '730419', adminEmail: admin }),
        ).toThrow(/together/)
    })

    it.each(['73041', '4829167', 'abcdef', '48 916', '4829.6'])(
        'rejects non 6-digit code %s',
        (code) => {
            expect(() =>
                resolveStoreReview({ email: 'r@b.com', code, adminEmail: admin }),
            ).toThrow(/6 digits/)
        },
    )

    it.each([
        '000000', '111111', '123456', '234567', '654321', '987654', '890123',
        '121212', '112211', '123123', '454545', '112233', '147258', '258369',
        '482916',
    ])(
        'rejects trivial code %s',
        (code) => {
            expect(() =>
                resolveStoreReview({ email: 'r@b.com', code, adminEmail: admin }),
            ).toThrow(/easy to guess/)
        },
    )

    it('rejects a malformed email', () => {
        expect(() =>
            resolveStoreReview({
                email: 'not-an-email',
                code: '730419',
                adminEmail: admin,
            }),
        ).toThrow(/valid email/)
    })

    it('treats empty strings as unset', () => {
        expect(
            resolveStoreReview({ email: '', code: '', adminEmail: admin }),
        ).toBeNull()
    })

    it('rejects the super admin email, case-insensitively', () => {
        expect(() =>
            resolveStoreReview({
                email: 'Admin@Super.com',
                code: '730419',
                adminEmail: admin,
            }),
        ).toThrow(/SUPER_ADMIN_EMAIL/)
    })

    it('returns the normalized config when valid', () => {
        expect(
            resolveStoreReview({
                email: ' Review@B.com ',
                code: '730419',
                adminEmail: admin,
            }),
        ).toEqual({ email: 'review@b.com', code: '730419' })
    })
})

describe('isStoreReviewEmail / storeReviewCodeMatches', () => {
    afterEach(() => {
        environment.storeReview = { email: undefined, code: undefined }
    })

    it('are false when unconfigured', () => {
        expect(isStoreReviewEmail('review@b.com')).toBe(false)
        expect(storeReviewCodeMatches('730419')).toBe(false)
    })

    it('match trimmed, case-insensitive email and the exact code', () => {
        environment.storeReview = { email: 'review@b.com', code: '730419' }
        expect(isStoreReviewEmail('  REVIEW@b.com ')).toBe(true)
        expect(isStoreReviewEmail('other@b.com')).toBe(false)
        expect(storeReviewCodeMatches('730419')).toBe(true)
        expect(storeReviewCodeMatches('730418')).toBe(false)
        expect(storeReviewCodeMatches('73041')).toBe(false)
    })
})
