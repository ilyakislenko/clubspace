import { dropInBlockReason, dropInClassBlock } from './drop-in-utils'

const now = new Date('2026-10-24T12:00:00Z')
const pack = {
    status: 'ACTIVE',
    startDate: null,
    endDate: new Date('2026-12-01T00:00:00Z'),
    classesRemaining: 4,
    directionIds: [] as string[],
}
const base = {
    featureOn: true,
    member: { status: 'ACTIVE' },
    subscriptionRequired: true,
    abonements: [pack],
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

    it('no_subscription without an abonement', () =>
        expect(dropInBlockReason({ ...base, abonements: [] })).toBe(
            'no_subscription',
        ))

    it.each([
        ['an expired pack', { endDate: new Date('2026-10-01T00:00:00Z') }],
        ['a cancelled pack', { status: 'CANCELLED' }],
    ])('no_subscription for %s', (_name, over) =>
        expect(
            dropInBlockReason({ ...base, abonements: [{ ...pack, ...over }] }),
        ).toBe('no_subscription'))

    it('no_classes at 0 remaining', () =>
        expect(
            dropInBlockReason({
                ...base,
                abonements: [{ ...pack, classesRemaining: 0 }],
            }),
        ).toBe('no_classes'))

    it('allows the last class of a single-visit pack', () =>
        expect(
            dropInBlockReason({
                ...base,
                abonements: [{ ...pack, classesRemaining: 1 }],
            }),
        ).toBeNull())

    it('allows a time-only abonement (null classesRemaining)', () =>
        expect(
            dropInBlockReason({
                ...base,
                abonements: [{ ...pack, classesRemaining: null }],
            }),
        ).toBeNull())

    it('allows a pack with no end date', () =>
        expect(
            dropInBlockReason({
                ...base,
                abonements: [{ ...pack, endDate: null }],
            }),
        ).toBeNull())

    it('skips the abonement checks when abonements are off in the club', () =>
        expect(
            dropInBlockReason({
                ...base,
                subscriptionRequired: false,
                abonements: [],
            }),
        ).toBeNull())

    it('classes_allocated when open bookings use up the classes left', () =>
        expect(dropInBlockReason({ ...base, openBookings: 4 })).toBe(
            'classes_allocated',
        ))

    it('allows while open bookings stay below the classes left', () =>
        expect(dropInBlockReason({ ...base, openBookings: 3 })).toBeNull())

    it('ignores open bookings against a time-only abonement until the cap', () => {
        const timeOnly = {
            ...base,
            abonements: [{ ...pack, classesRemaining: null }],
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
                abonements: [],
                openBookings: 5,
            }),
        ).toBe('too_many_bookings'))

    describe('several abonements', () => {
        it('passes when any one is live and has a class left', () =>
            expect(
                dropInBlockReason({
                    ...base,
                    abonements: [
                        { ...pack, classesRemaining: 0 },
                        { ...pack, status: 'CANCELLED' },
                        { ...pack, classesRemaining: 2, directionIds: ['bjj'] },
                    ],
                }),
            ).toBeNull())

        it('adds up the classes left on live packs against open bookings', () => {
            const two = {
                ...base,
                abonements: [
                    { ...pack, classesRemaining: 1, directionIds: ['bjj'] },
                    { ...pack, classesRemaining: 2, directionIds: ['mma'] },
                ],
            }
            expect(dropInBlockReason({ ...two, openBookings: 2 })).toBeNull()
            expect(dropInBlockReason({ ...two, openBookings: 3 })).toBe(
                'classes_allocated',
            )
        })

        it('a live time-based one lifts the balance limit', () =>
            expect(
                dropInBlockReason({
                    ...base,
                    abonements: [
                        { ...pack, classesRemaining: 0 },
                        { ...pack, classesRemaining: null, directionIds: ['bjj'] },
                    ],
                    openBookings: 4,
                }),
            ).toBeNull())
    })
})

describe('dropInClassBlock', () => {
    const startAt = new Date('2026-10-31T12:00:00Z')
    const live = { ...pack, frozenUntil: null as Date | null }
    const block = (
        abonements: Array<typeof live>,
        over: {
            classDirectionId?: string | null
            openBookingDirections?: Array<string | null>
        } = {},
    ) =>
        dropInClassBlock({
            abonements,
            classDirectionId: 'bjj',
            startAt,
            openBookingDirections: [],
            ...over,
        })

    it('passes with a club-wide pack that runs at the class start', () =>
        expect(block([live])).toBeNull())

    it('not_covered when no abonement covers the class direction', () => {
        expect(block([{ ...live, directionIds: ['mma'] }])).toEqual({
            kind: 'not_covered',
        })
        expect(block([])).toEqual({ kind: 'not_covered' })
    })

    it('a class without a direction is covered only by a club-wide one', () => {
        expect(
            block([{ ...live, directionIds: ['bjj'] }], { classDirectionId: null }),
        ).toEqual({ kind: 'not_covered' })
        expect(block([live], { classDirectionId: null })).toBeNull()
    })

    it('a БЖЖ+ММА pack covers БЖЖ and ММА classes, not Muay Thai', () => {
        const multi = { ...live, directionIds: ['bjj', 'mma'] }
        expect(block([multi], { classDirectionId: 'bjj' })).toBeNull()
        expect(block([multi], { classDirectionId: 'mma' })).toBeNull()
        expect(block([multi], { classDirectionId: 'muay-thai' })).toEqual({
            kind: 'not_covered',
        })
    })

    it('ends_before when every covering abonement ends before the class (or starts after it)', () => {
        expect(
            block([{ ...live, endDate: new Date('2026-10-31T11:59:00Z') }]),
        ).toEqual({ kind: 'ends_before' })
        expect(
            block([{ ...live, startDate: new Date('2026-11-01T00:00:00Z') }]),
        ).toEqual({ kind: 'ends_before' })
        // Ending exactly at the start still covers it; no end date always does.
        expect(block([{ ...live, endDate: startAt }])).toBeNull()
        expect(block([{ ...live, endDate: null }])).toBeNull()
    })

    it('frozen (with the latest end) when every running covering abonement is frozen that day', () => {
        expect(
            block([
                { ...live, frozenUntil: new Date('2026-11-02T00:00:00Z') },
                {
                    ...live,
                    directionIds: ['bjj'],
                    frozenUntil: new Date('2026-11-05T00:00:00Z'),
                },
            ]),
        ).toEqual({ kind: 'frozen', until: new Date('2026-11-05T00:00:00Z') })
    })

    it('a frozen abonement is skipped while another one can pay', () =>
        expect(
            block([
                { ...live, directionIds: ['bjj'], frozenUntil: new Date('2026-11-05T00:00:00Z') },
                live,
            ]),
        ).toBeNull())

    it('no_classes when every payer is a used-up pack', () =>
        expect(block([{ ...live, classesRemaining: 0 }])).toEqual({
            kind: 'no_classes',
        }))

    it('counts open bookings only against the packs that could pay for them', () => {
        const bjj = { ...live, classesRemaining: 1, directionIds: ['bjj'] }
        // An ММА booking is not paid by the БЖЖ pack.
        expect(block([bjj], { openBookingDirections: ['mma'] })).toBeNull()
        expect(block([bjj], { openBookingDirections: ['bjj'] })).toEqual({
            kind: 'classes_allocated',
        })
        // Club-wide packs pay for anything.
        expect(
            block([{ ...live, classesRemaining: 2 }], {
                openBookingDirections: ['mma', null],
            }),
        ).toEqual({ kind: 'classes_allocated' })
    })

    it('a time-based payer lifts the balance limit', () =>
        expect(
            block([{ ...live, classesRemaining: null }], {
                openBookingDirections: ['bjj', 'bjj', 'bjj'],
            }),
        ).toBeNull())
})
