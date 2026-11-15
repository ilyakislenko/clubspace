import {
    anchorCancelledByClub,
    autopayCardLabel,
    autopayDueAt,
    autopayIdempotenceKey,
    autopayNextChargeOn,
    autopayRetryAt,
    inChargeWindow,
    MAX_AUTOPAY_ATTEMPTS,
    pickAnchor,
    reminderAt,
    termsCheck,
} from './autopay-rules'

const MSK = 'Europe/Moscow' // UTC+3
const VVO = 'Asia/Vladivostok' // UTC+10

const now = new Date('2026-11-20T09:00:00Z')

// A term abonement starting/ending at Moscow midnight (21:00Z the day before).
const sub = (over: Record<string, unknown> = {}) => ({
    id: 's-1',
    status: 'ACTIVE',
    startDate: new Date('2026-11-14T21:00:00Z'),
    endDate: new Date('2026-12-14T21:00:00Z'), // S = 2026-12-15
    classesTotal: null as number | null,
    classesRemaining: null as number | null,
    createdAt: new Date('2026-11-14T10:00:00Z'),
    directions: [] as Array<{ directionId: string }>,
    ...over,
})

describe('pickAnchor', () => {
    it('takes the latest same-scope abonement, current or ended within 30 days', () => {
        const old = sub({ id: 'old', endDate: new Date('2026-11-14T21:00:00Z') })
        const current = sub({ id: 'cur' })
        expect(pickAnchor([old, current], [], now)?.id).toBe('cur')
        expect(pickAnchor([old], [], now)?.id).toBe('old')
        const ancient = sub({ id: 'ancient', endDate: new Date('2026-10-01T21:00:00Z') })
        expect(pickAnchor([ancient], [], now)).toBeNull()
    })

    it('excludes cancelled abonements and other scopes', () => {
        const cancelled = sub({ id: 'x', status: 'CANCELLED' })
        const bjj = sub({ id: 'bjj', directions: [{ directionId: 'bjj' }] })
        expect(pickAnchor([cancelled], [], now)).toBeNull()
        expect(pickAnchor([bjj], [], now)).toBeNull()
        expect(pickAnchor([bjj], ['bjj'], now)?.id).toBe('bjj')
    })

    it('moves to a staff renewal sold after the current one, and to one waiting for its first visit', () => {
        const current = sub({ id: 'cur' })
        const renewal = sub({
            id: 'cash',
            startDate: new Date('2026-12-14T21:00:00Z'),
            endDate: new Date('2027-01-13T21:00:00Z'),
            createdAt: new Date('2026-11-19T10:00:00Z'),
        })
        expect(pickAnchor([current, renewal], [], now)?.id).toBe('cash')
        const waiting = sub({ id: 'wait', startDate: null, endDate: null })
        expect(pickAnchor([current, waiting], [], now)?.id).toBe('wait')
    })
})

describe('anchorCancelledByClub', () => {
    it('is true when the newest same-scope abonement is cancelled and nothing is current', () => {
        const ended = sub({ id: 'ended', endDate: new Date('2026-11-18T21:00:00Z') })
        const cancelled = sub({ id: 'x', status: 'CANCELLED', createdAt: new Date('2026-11-19T00:00:00Z') })
        expect(anchorCancelledByClub([ended, cancelled], [], now)).toBe(true)
        expect(anchorCancelledByClub([sub(), cancelled], [], now)).toBe(false)
        expect(anchorCancelledByClub([ended], [], now)).toBe(false)
    })
})

describe('autopayDueAt', () => {
    it('charges a term at 10:00 club-local on S − 1 (Moscow and Vladivostok)', () => {
        expect(autopayDueAt(sub(), MSK, null)).toEqual(new Date('2026-12-14T07:00:00Z'))
        const vvo = sub({ endDate: new Date('2026-12-14T14:00:00Z') }) // VVO midnight of 12-15
        expect(autopayDueAt(vvo, VVO, null)).toEqual(new Date('2026-12-14T00:00:00Z'))
    })

    it('charges a used-up pack 1 h after its last check-in, else at S 10:00', () => {
        const pack = sub({ classesTotal: 8, classesRemaining: 0 })
        const lastUsed = new Date('2026-11-20T15:30:00Z')
        expect(autopayDueAt(pack, MSK, lastUsed)).toEqual(new Date('2026-11-20T16:30:00Z'))
        const left = sub({ classesTotal: 8, classesRemaining: 2 })
        expect(autopayDueAt(left, MSK, lastUsed)).toEqual(new Date('2026-12-15T07:00:00Z'))
        // Used up just before the term ends: the term end comes first.
        const late = new Date('2026-12-15T06:30:00Z')
        expect(autopayDueAt(pack, MSK, late)).toEqual(new Date('2026-12-15T07:00:00Z'))
        // A pack with classes left that ends later on S (an online grant ends at
        // its purchase time): charged when it ends, never over the live pack.
        const endsAtNoon = sub({ classesTotal: 8, classesRemaining: 2, endDate: new Date('2026-12-15T09:00:00Z') })
        expect(autopayDueAt(endsAtNoon, MSK, lastUsed)).toEqual(new Date('2026-12-15T09:00:00Z'))
    })

    it('is null while the abonement waits for its first visit', () => {
        expect(autopayDueAt(sub({ startDate: null, endDate: null }), MSK, null)).toBeNull()
    })

    it('moves with a freeze-extended end', () => {
        const frozen = sub({ endDate: new Date('2026-12-24T21:00:00Z') })
        expect(autopayDueAt(frozen, MSK, null)).toEqual(new Date('2026-12-24T07:00:00Z'))
    })
})

describe('reminderAt', () => {
    it('is 3 days before the charge: S − 4 for a term, S − 3 for a pack with classes left', () => {
        expect(reminderAt(sub(), MSK)).toEqual(new Date('2026-12-11T07:00:00Z'))
        const pack = sub({ classesTotal: 8, classesRemaining: 3 })
        expect(reminderAt(pack, MSK)).toEqual(new Date('2026-12-12T07:00:00Z'))
        expect(reminderAt(sub({ classesTotal: 8, classesRemaining: 0 }), MSK)).toBeNull()
        expect(reminderAt(sub({ startDate: null, endDate: null }), MSK)).toBeNull()
    })
})

describe('inChargeWindow', () => {
    it('is open from 10:00 up to (not including) 20:00 club-local', () => {
        expect(inChargeWindow(new Date('2026-11-20T06:59:00Z'), MSK)).toBe(false)
        expect(inChargeWindow(new Date('2026-11-20T07:00:00Z'), MSK)).toBe(true)
        expect(inChargeWindow(new Date('2026-11-20T16:59:00Z'), MSK)).toBe(true)
        expect(inChargeWindow(new Date('2026-11-20T17:00:00Z'), MSK)).toBe(false)
        expect(inChargeWindow(new Date('2026-11-20T00:00:00Z'), VVO)).toBe(true)
    })
})

describe('autopayRetryAt', () => {
    it('retries at 10:00 on the next day, the day after, then two days later; stops after the 4th', () => {
        const declinedAt = new Date('2026-12-14T07:05:00Z') // S − 1
        expect(autopayRetryAt(declinedAt, MSK, 1)).toEqual(new Date('2026-12-15T07:00:00Z')) // S
        expect(autopayRetryAt(new Date('2026-12-15T07:05:00Z'), MSK, 2)).toEqual(
            new Date('2026-12-16T07:00:00Z'),
        ) // S + 1
        expect(autopayRetryAt(new Date('2026-12-16T07:05:00Z'), MSK, 3)).toEqual(
            new Date('2026-12-18T07:00:00Z'),
        ) // S + 3
        expect(autopayRetryAt(new Date('2026-12-18T07:05:00Z'), MSK, MAX_AUTOPAY_ATTEMPTS)).toBeNull()
    })
})

describe('termsCheck', () => {
    const terms = { termsAmount: 4000, currency: 'RUB', termsDurationDays: 30, termsClassCount: null }
    const plan = { durationDays: 30, classCount: null, currency: 'RUB' }
    it('is ok at the agreed amount, lower below it, changed above it', () => {
        expect(termsCheck(terms, plan, 4000)).toBe('ok')
        expect(termsCheck(terms, plan, 3500)).toBe('lower')
        expect(termsCheck(terms, plan, 4500)).toBe('changed')
    })
    it('is changed on another term, pack size or currency', () => {
        expect(termsCheck(terms, { ...plan, durationDays: 28 }, 3000)).toBe('changed')
        expect(termsCheck(terms, { ...plan, classCount: 12 }, 4000)).toBe('changed')
        expect(termsCheck(terms, { ...plan, currency: 'KZT' }, 4000)).toBe('changed')
    })
})

describe('helpers', () => {
    it('names the next charge day per kind', () => {
        expect(autopayNextChargeOn(sub(), MSK, null)).toEqual({ on: '2026-12-14', kind: 'term' })
        expect(autopayNextChargeOn(sub({ classesTotal: 8, classesRemaining: 3 }), MSK, null)).toEqual({
            on: '2026-12-15',
            kind: 'pack',
        })
        expect(
            autopayNextChargeOn(
                sub({ classesTotal: 8, classesRemaining: 0 }),
                MSK,
                new Date('2026-11-20T15:30:00Z'),
            ),
        ).toEqual({ on: '2026-11-20', kind: 'pack' })
        expect(autopayNextChargeOn(sub({ startDate: null, endDate: null }), MSK, null)).toBeNull()
    })

    it('keys a charge per renewed abonement and attempt within Payment.idempotenceKey', () => {
        const key = autopayIdempotenceKey('11111111-1111-4111-8111-111111111111', 3)
        expect(key).toBe('autopay:11111111-1111-4111-8111-111111111111:3')
        expect(key.length).toBeLessThanOrEqual(64)
    })

    it('labels the card without the token', () => {
        expect(autopayCardLabel('4444')).toBe('карта •• 4444')
        expect(autopayCardLabel(null)).toBe('сохранённый способ оплаты')
    })
})
