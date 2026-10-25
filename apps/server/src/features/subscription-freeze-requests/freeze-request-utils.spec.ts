import {
    approvalStartYmd,
    closeRequestData,
    freezeRequestWindow,
    lastFreezeStartYmd,
    memberFreezeRefusal,
    personName,
    requestRange,
    requestUntilYmd,
} from './freeze-request-utils'

const TZ = 'Asia/Tomsk' // UTC+7
const now = new Date('2026-10-25T05:00:00Z') // 12:00 local, 2026-10-25

const sub = (over: Record<string, unknown> = {}) => ({
    status: 'ACTIVE',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2026-11-10T00:00:00Z'),
    classesRemaining: null as number | null,
    ...over,
})

const window = (over: Record<string, unknown> = {}) =>
    freezeRequestWindow({
        now,
        tz: TZ,
        subscription: sub(),
        hasOpenFreeze: false,
        hasPending: false,
        ...over,
    })

describe('freeze request dates', () => {
    it('requestUntilYmd is fromDate + days - 1', () => {
        expect(requestUntilYmd('2026-10-28', 7)).toBe('2026-11-03')
        expect(requestUntilYmd('2026-10-28', 1)).toBe('2026-10-28')
    })

    it('requestRange returns db dates for formatFreezeRange', () => {
        const r = requestRange({
            fromDate: new Date('2026-10-28T00:00:00Z'),
            days: 3,
        })
        expect(r.fromDate.toISOString()).toBe('2026-10-28T00:00:00.000Z')
        expect(r.untilDate.toISOString()).toBe('2026-10-30T00:00:00.000Z')
    })

    it('lastFreezeStartYmd is the local day before an endDate at local midnight', () => {
        // 2026-11-10 00:00 local (UTC+7) = 2026-11-09T17:00Z
        expect(
            lastFreezeStartYmd(new Date('2026-11-09T17:00:00Z'), TZ),
        ).toBe('2026-11-09')
        // mid-day end: the same local day
        expect(
            lastFreezeStartYmd(new Date('2026-11-10T05:00:00Z'), TZ),
        ).toBe('2026-11-10')
    })

    it('approvalStartYmd takes the later day', () => {
        expect(approvalStartYmd('2026-10-30', '2026-10-25')).toBe('2026-10-30')
        expect(approvalStartYmd('2026-10-20', '2026-10-25')).toBe('2026-10-25')
        expect(approvalStartYmd('2026-10-25', '2026-10-25')).toBe('2026-10-25')
    })
})

describe('closeRequestData', () => {
    it('always frees the pending slot', () => {
        expect(closeRequestData('CANCELLED')).toEqual({
            status: 'CANCELLED',
            pendingSubscriptionId: null,
        })
        expect(closeRequestData('DECLINED', { decisionComment: 'x' })).toEqual({
            status: 'DECLINED',
            pendingSubscriptionId: null,
            decisionComment: 'x',
        })
    })
})

describe('memberFreezeRefusal', () => {
    const ask = (over: Record<string, unknown> = {}) =>
        memberFreezeRefusal({
            fromYmd: '2026-10-26',
            days: 7,
            now,
            tz: TZ,
            subscription: sub(),
            ...over,
        })

    it('accepts a fitting ask', () => {
        expect(ask()).toBeNull()
    })

    it('refuses a pack with no classes left', () => {
        expect(ask({ subscription: sub({ classesRemaining: 0 }) })).toBe(
            'В абонементе не осталось занятий — замораживать нечего',
        )
    })

    it('delegates to the shared window rules', () => {
        expect(ask({ fromYmd: '2026-10-20' })).toBe(
            'Дата начала заморозки не может быть в прошлом',
        )
        expect(ask({ subscription: sub({ startDate: null }) })).toContain(
            'ещё не начался',
        )
    })
})

describe('freezeRequestWindow', () => {
    it('opens from today to the last day before the end', () => {
        expect(window()).toEqual({
            today: '2026-10-25',
            firstDate: '2026-10-25',
            lastDate: '2026-11-10',
            maxDays: 90,
        })
    })

    it('endDate at local midnight leaves the day before as last', () => {
        const w = window({
            subscription: sub({ endDate: new Date('2026-11-09T17:00:00Z') }),
        })
        expect(w?.lastDate).toBe('2026-11-09')
    })

    it('starts at a future startDate', () => {
        const w = window({
            subscription: sub({ startDate: new Date('2026-10-29T17:00:00Z') }),
        })
        expect(w?.firstDate).toBe('2026-10-30')
    })

    it('is null with an open freeze or a pending request', () => {
        expect(window({ hasOpenFreeze: true })).toBeNull()
        expect(window({ hasPending: true })).toBeNull()
    })

    it('is null when the abonement is not freezable', () => {
        expect(window({ subscription: sub({ startDate: null }) })).toBeNull()
        expect(window({ subscription: sub({ endDate: null }) })).toBeNull()
        expect(window({ subscription: sub({ status: 'CANCELLED' }) })).toBeNull()
        expect(
            window({ subscription: sub({ classesRemaining: 0 }) }),
        ).toBeNull()
        expect(
            window({
                subscription: sub({ endDate: new Date('2026-10-20T00:00:00Z') }),
            }),
        ).toBeNull()
    })

    it('is null when the last start day is before the first', () => {
        // ends at local midnight of today: nothing left to start on
        expect(
            window({
                subscription: sub({ endDate: new Date('2026-10-24T17:00:00Z') }),
            }),
        ).toBeNull()
    })
})

describe('personName', () => {
    it('is «Фамилия Имя» and null when nameless', () => {
        expect(personName({ firstname: 'Иван', lastname: 'Петров' })).toBe(
            'Петров Иван',
        )
        expect(personName({ firstname: ' Иван ', lastname: null })).toBe('Иван')
        expect(personName({ firstname: null, lastname: ' ' })).toBeNull()
        expect(personName(null)).toBeNull()
    })
})
