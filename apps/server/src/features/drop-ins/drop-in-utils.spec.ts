import { dropInBlockReason } from './drop-in-utils'

const now = new Date('2026-10-24T12:00:00Z')
const base = {
    featureOn: true,
    member: { status: 'ACTIVE' },
    subscriptionRequired: true,
    subscription: {
        status: 'ACTIVE',
        endDate: new Date('2026-12-01T00:00:00Z'),
        classesRemaining: 4,
    },
    now,
}

describe('dropInBlockReason', () => {
    it('allows an active member with a live pack', () =>
        expect(dropInBlockReason(base)).toBeNull())

    it('feature_off wins over everything', () =>
        expect(
            dropInBlockReason({ ...base, featureOn: false, member: null }),
        ).toBe('feature_off'))

    it('not_member for the owner (no member row)', () =>
        expect(dropInBlockReason({ ...base, member: null })).toBe(
            'not_member',
        ))

    it('inactive for a non-ACTIVE member', () =>
        expect(
            dropInBlockReason({ ...base, member: { status: 'SUSPENDED' } }),
        ).toBe('inactive'))

    it('no_subscription without a pack', () =>
        expect(dropInBlockReason({ ...base, subscription: null })).toBe(
            'no_subscription',
        ))

    it('no_subscription for an expired pack', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscription: {
                    ...base.subscription,
                    endDate: new Date('2026-10-01T00:00:00Z'),
                },
            }),
        ).toBe('no_subscription'))

    it('no_subscription for a cancelled pack', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscription: { ...base.subscription, status: 'CANCELLED' },
            }),
        ).toBe('no_subscription'))

    it('no_classes at 0 remaining', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscription: { ...base.subscription, classesRemaining: 0 },
            }),
        ).toBe('no_classes'))

    it('allows the last class of a single-visit pack', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscription: { ...base.subscription, classesRemaining: 1 },
            }),
        ).toBeNull())

    it('allows a time-only pack (null classesRemaining)', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscription: { ...base.subscription, classesRemaining: null },
            }),
        ).toBeNull())

    it('allows a pack with no end date', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscription: { ...base.subscription, endDate: null },
            }),
        ).toBeNull())

    it('skips the pack checks when abonements are off in the club', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscriptionRequired: false,
                subscription: null,
            }),
        ).toBeNull())
})
