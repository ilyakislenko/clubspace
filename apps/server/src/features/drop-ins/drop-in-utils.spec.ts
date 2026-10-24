import { dropInBlockReason, subscriptionEndsBeforeClass } from './drop-in-utils'

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
    openBookings: 0,
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

    it('classes_allocated when open bookings use up the classes left', () =>
        expect(dropInBlockReason({ ...base, openBookings: 4 })).toBe(
            'classes_allocated',
        ))

    it('allows while open bookings stay below the classes left', () =>
        expect(dropInBlockReason({ ...base, openBookings: 3 })).toBeNull())

    it('ignores open bookings against a time-only pack until the cap', () => {
        const timeOnly = {
            ...base,
            subscription: { ...base.subscription, classesRemaining: null },
        }
        expect(dropInBlockReason({ ...timeOnly, openBookings: 4 })).toBeNull()
        expect(dropInBlockReason({ ...timeOnly, openBookings: 5 })).toBe(
            'too_many_bookings',
        )
    })

    it('caps at 5 even when abonements are off', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscriptionRequired: false,
                subscription: null,
                openBookings: 5,
            }),
        ).toBe('too_many_bookings'))
})

describe('subscriptionEndsBeforeClass', () => {
    const startAt = new Date('2026-10-31T12:00:00Z')
    const on = { subscriptionRequired: true, startAt }

    it('true when the pack ends before the class starts', () =>
        expect(
            subscriptionEndsBeforeClass({
                ...on,
                subscription: { endDate: new Date('2026-10-31T11:59:00Z') },
            }),
        ).toBe(true))

    it('false when it ends at or after the start, has no end date, or abonements are off', () => {
        expect(
            subscriptionEndsBeforeClass({
                ...on,
                subscription: { endDate: startAt },
            }),
        ).toBe(false)
        expect(
            subscriptionEndsBeforeClass({ ...on, subscription: { endDate: null } }),
        ).toBe(false)
        expect(
            subscriptionEndsBeforeClass({
                ...on,
                subscriptionRequired: false,
                subscription: { endDate: new Date('2026-01-01T00:00:00Z') },
            }),
        ).toBe(false)
    })
})
