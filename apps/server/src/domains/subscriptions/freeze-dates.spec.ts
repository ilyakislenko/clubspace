import {
    addDaysYmd,
    formatFreezeRange,
    freezeDays,
    freezePhase,
    planFreezeEnd,
    validateFreezeWindow,
    ymdToDbDate,
} from './freeze-dates'

const freeze = (from: string, until: string) => ({
    fromDate: ymdToDbDate(from),
    untilDate: ymdToDbDate(until),
})

describe('addDaysYmd', () => {
    it('crosses month and year boundaries both ways', () => {
        expect(addDaysYmd('2026-10-30', 3)).toBe('2026-11-02')
        expect(addDaysYmd('2026-12-30', 3)).toBe('2027-01-02')
        expect(addDaysYmd('2026-11-01', -1)).toBe('2026-10-31')
        expect(addDaysYmd('2027-03-01', -1)).toBe('2027-02-28')
    })
})

describe('freezeDays', () => {
    it('counts both ends inclusive', () => {
        expect(freezeDays(freeze('2026-10-24', '2026-10-24'))).toBe(1)
        expect(freezeDays(freeze('2026-10-24', '2026-10-30'))).toBe(7)
        expect(freezeDays(freeze('2026-10-28', '2026-11-03'))).toBe(7)
    })
})

describe('freezePhase', () => {
    const f = freeze('2026-10-24', '2026-10-30')
    it('is current on both boundary days', () => {
        expect(freezePhase(f, '2026-10-24')).toBe('current')
        expect(freezePhase(f, '2026-10-30')).toBe('current')
    })
    it('is upcoming the day before and past the day after', () => {
        expect(freezePhase(f, '2026-10-23')).toBe('upcoming')
        expect(freezePhase(f, '2026-10-31')).toBe('past')
    })
})

describe('planFreezeEnd', () => {
    const f = freeze('2026-10-24', '2026-10-30')
    it('removes a freeze that has not started, returning every day', () => {
        expect(planFreezeEnd(f, '2026-10-20')).toEqual({
            kind: 'remove',
            returnDays: 7,
        })
    })
    it('removes a freeze that starts today', () => {
        expect(planFreezeEnd(f, '2026-10-24')).toEqual({
            kind: 'remove',
            returnDays: 7,
        })
    })
    it('shrinks a running freeze to yesterday and returns the unused days', () => {
        expect(planFreezeEnd(f, '2026-10-27')).toEqual({
            kind: 'shrink',
            returnDays: 4,
            untilYmd: '2026-10-26',
        })
    })
    it('returns one day on the last day', () => {
        expect(planFreezeEnd(f, '2026-10-30')).toEqual({
            kind: 'shrink',
            returnDays: 1,
            untilYmd: '2026-10-29',
        })
    })
    it('refuses a freeze that is over', () => {
        expect(planFreezeEnd(f, '2026-10-31')).toEqual({ kind: 'finished' })
    })
})

describe('formatFreezeRange', () => {
    it('collapses the month inside one month', () => {
        expect(formatFreezeRange(freeze('2026-10-24', '2026-10-30'))).toBe(
            'с 24 по 30 октября',
        )
    })
    it('names both months across a month boundary', () => {
        expect(formatFreezeRange(freeze('2026-10-28', '2026-11-03'))).toBe(
            'с 28 октября по 3 ноября',
        )
    })
})

describe('validateFreezeWindow', () => {
    const NOW = new Date('2026-10-24T10:00:00Z')
    const base = () => ({
        fromYmd: '2026-10-24',
        todayYmd: '2026-10-24',
        days: 7,
        timezone: 'Europe/Moscow',
        now: NOW,
        subscription: {
            status: 'ACTIVE',
            startDate: new Date('2026-10-01T00:00:00Z'),
            endDate: new Date('2026-11-30T00:00:00Z'),
        },
    })

    it('accepts a fitting window', () => {
        expect(validateFreezeWindow(base())).toBeNull()
    })
    it('refuses a cancelled abonement', () => {
        const p = base()
        p.subscription.status = 'CANCELLED'
        expect(validateFreezeWindow(p)).toMatch(/отменён/)
    })
    it('refuses a non-active abonement', () => {
        const p = base()
        p.subscription.status = 'SUSPENDED'
        expect(validateFreezeWindow(p)).toMatch(/только действующий/)
    })
    it('refuses an abonement without a term', () => {
        const p = base()
        ;(p.subscription as { endDate: Date | null }).endDate = null
        expect(validateFreezeWindow(p)).toMatch(/нет срока действия/)
    })
    it('refuses an abonement that already ended', () => {
        const p = base()
        p.subscription.endDate = new Date('2026-10-20T00:00:00Z')
        expect(validateFreezeWindow(p)).toMatch(/уже закончился/)
    })
    it('refuses a length outside 1..90 or fractional', () => {
        for (const days of [0, 91, 1.5]) {
            expect(validateFreezeWindow({ ...base(), days })).toMatch(
                /от 1 до 90 дней/,
            )
        }
    })
    it('refuses a start in the past', () => {
        expect(
            validateFreezeWindow({ ...base(), fromYmd: '2026-10-23' }),
        ).toMatch(/в прошлом/)
    })
    it('refuses a start before the abonement begins', () => {
        const p = base()
        p.subscription.startDate = new Date('2026-10-26T00:00:00Z')
        expect(validateFreezeWindow(p)).toMatch(
            /Абонемент начинается 26 октября/,
        )
    })
    it('refuses a start on or after the abonement end', () => {
        expect(
            validateFreezeWindow({ ...base(), fromYmd: '2026-12-01' }),
        ).toMatch(/Абонемент действует до 30 ноября/)
    })
})
