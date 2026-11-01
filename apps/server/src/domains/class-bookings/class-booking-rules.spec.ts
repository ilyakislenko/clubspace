import {
    bookingBlock,
    bookingSettings,
    cancelDeadline,
    effectiveCapacity,
    isLateCancel,
    waitlistPositions,
    type BookingAbonement,
} from './class-booking-rules'

const HOUR = 3_600_000
const start = new Date('2026-11-10T16:00:00Z')

const abonement = (over: Partial<BookingAbonement> = {}): BookingAbonement => ({
    status: 'ACTIVE',
    startDate: new Date('2026-11-01T00:00:00Z'),
    endDate: new Date('2026-12-01T00:00:00Z'),
    classesTotal: 8,
    classesRemaining: 3,
    directionIds: [],
    frozen: false,
    ...over,
})

describe('class booking rules', () => {
    it('capacity: the date overrides the slot, the slot the group; none = unlimited', () => {
        expect(effectiveCapacity({ occurrence: 5, slot: 8, group: 12 })).toBe(5)
        expect(effectiveCapacity({ occurrence: null, slot: 8, group: 12 })).toBe(8)
        expect(effectiveCapacity({ occurrence: undefined, slot: null, group: 12 })).toBe(12)
        expect(effectiveCapacity({ occurrence: null, slot: null, group: null })).toBeNull()
    })

    it('settings: a group overrides window and deadline, burns stay the club’s', () => {
        const club = {
            bookingWindowDays: 14,
            bookingCancelHours: 12,
            bookingLateCancelBurn: true,
            bookingNoShowBurn: false,
        }
        expect(
            bookingSettings(club, { bookingWindowDays: null, bookingCancelHours: null }),
        ).toEqual({ windowDays: 14, cancelHours: 12, lateCancelBurn: true, noShowBurn: false })
        expect(
            bookingSettings(club, { bookingWindowDays: 3, bookingCancelHours: 0 }),
        ).toMatchObject({ windowDays: 3, cancelHours: 0 })
    })

    it('late cancel: a held place after the deadline, unless it came from the waitlist after it', () => {
        const base = { startAt: start, cancelHours: 12, promotedAt: null }
        const deadline = cancelDeadline(start, 12)
        expect(deadline.toISOString()).toBe('2026-11-10T04:00:00.000Z')
        expect(isLateCancel({ ...base, status: 'BOOKED', now: new Date(deadline.getTime() - 1) })).toBe(false)
        expect(isLateCancel({ ...base, status: 'BOOKED', now: new Date(deadline.getTime() + 1) })).toBe(true)
        expect(isLateCancel({ ...base, status: 'WAITLISTED', now: start })).toBe(false)
        expect(
            isLateCancel({
                ...base,
                status: 'BOOKED',
                promotedAt: new Date(deadline.getTime() + HOUR),
                now: new Date(deadline.getTime() + 2 * HOUR),
            }),
        ).toBe(false)
        expect(
            isLateCancel({
                ...base,
                status: 'BOOKED',
                promotedAt: new Date(deadline.getTime() - HOUR),
                now: new Date(deadline.getTime() + HOUR),
            }),
        ).toBe(true)
    })

    describe('bookingBlock', () => {
        const p = (abonements: BookingAbonement[], held: Array<string | null> = []) =>
            bookingBlock({
                abonements,
                classDirectionId: 'pole',
                startAt: start,
                heldDirections: held,
            })

        it('needs an abonement whose scope covers the class', () => {
            expect(p([])).toBe('no_abonement')
            expect(p([abonement({ directionIds: ['yoga'] })])).toBe('no_abonement')
            expect(p([abonement({ status: 'CANCELLED' })])).toBe('no_abonement')
            expect(p([abonement({ directionIds: ['pole'] })])).toBeNull()
            expect(p([abonement()])).toBeNull()
        })

        it('that runs at the class start and is not frozen that day', () => {
            expect(p([abonement({ endDate: new Date(start.getTime() - 1) })])).toBe('ends_before')
            expect(p([abonement({ startDate: new Date(start.getTime() + 1) })])).toBe('ends_before')
            expect(p([abonement({ startDate: null, endDate: null })])).toBeNull()
            expect(p([abonement({ frozen: true })])).toBe('frozen')
        })

        it('with a class left — packs are not over-promised, a time-based one pays for any number', () => {
            expect(p([abonement({ classesRemaining: 0 })])).toBe('no_classes')
            expect(p([abonement({ classesRemaining: 2 })], ['pole'])).toBeNull()
            expect(p([abonement({ classesRemaining: 2 })], ['pole', null])).toBe('classes_allocated')
            // A class of another direction this pack can't pay for doesn't count.
            expect(p([abonement({ classesRemaining: 1, directionIds: ['pole'] })], ['yoga'])).toBeNull()
            expect(
                p(
                    [abonement({ classesRemaining: 1 }), abonement({ classesTotal: null, classesRemaining: null })],
                    ['pole', 'pole'],
                ),
            ).toBeNull()
        })
    })

    it('waitlist positions: oldest first, ties by id, places ignored', () => {
        const at = (m: number) => new Date(start.getTime() + m * 60_000)
        const positions = waitlistPositions([
            { id: 'c', status: 'WAITLISTED', createdAt: at(2) },
            { id: 'a', status: 'BOOKED', createdAt: at(0) },
            { id: 'e', status: 'WAITLISTED', createdAt: at(1) },
            { id: 'd', status: 'WAITLISTED', createdAt: at(1) },
        ])
        expect([...positions.entries()]).toEqual([
            ['d', 1],
            ['e', 2],
            ['c', 3],
        ])
    })
})
