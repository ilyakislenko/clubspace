import {
    isReminderHour,
    paymentReminderIndex,
    paymentReminderText,
} from './payment-reminder'

describe('paymentReminderIndex', () => {
    it.each([
        ['2026-10-22', '2026-10-22', null],
        ['2026-10-22', '2026-10-23', 0],
        ['2026-10-22', '2026-10-25', 0],
        ['2026-10-22', '2026-10-26', 1],
        ['2026-10-22', '2026-10-29', 2],
        ['2026-10-22', '2026-11-01', 3],
        ['2026-10-22', '2026-11-04', null],
        ['2026-10-22', '2026-10-21', null],
    ])('start %s today %s -> %p', (start, today, expected) => {
        expect(paymentReminderIndex(start, today)).toBe(expected)
    })
})

describe('isReminderHour', () => {
    const tz = 'Asia/Tomsk' // UTC+7
    it('allows [10, 21) club-local', () => {
        expect(isReminderHour(new Date('2026-10-24T03:00:00Z'), tz)).toBe(true)
        expect(isReminderHour(new Date('2026-10-24T13:59:00Z'), tz)).toBe(true)
    })
    it('refuses before 10 and from 21', () => {
        expect(isReminderHour(new Date('2026-10-24T02:59:00Z'), tz)).toBe(false)
        expect(isReminderHour(new Date('2026-10-24T14:00:00Z'), tz)).toBe(false)
    })
})

describe('paymentReminderText', () => {
    const base = {
        planName: '12 занятий',
        startDate: new Date('2026-10-21T17:00:00Z'), // 22 Oct, Tomsk
        timezone: 'Asia/Tomsk',
    }
    const at = (s: string) => new Date(`${s}T05:00:00Z`)

    it('names the coach with a formatted phone and lists the visits', () => {
        expect(
            paymentReminderText({
                ...base,
                coach: { name: 'Чертовских Роман', phone: '+79528849420' },
                visits: [at('2026-10-22'), at('2026-10-24')],
            }),
        ).toBe(
            '«12 занятий»: абонемент начался 22 октября, но оплата пока не отмечена. Тренер группы: Чертовских Роман, +7 952 884-94-20. Визиты по абонементу: 22.10, 24.10. Если вы уже оплатили, напомните тренеру отметить оплату.',
        )
    })

    it('drops the phone, the coach and the visits when missing', () => {
        expect(
            paymentReminderText({
                ...base,
                coach: { name: 'Роман', phone: null },
                visits: [],
            }),
        ).toBe(
            '«12 занятий»: абонемент начался 22 октября, но оплата пока не отмечена. Тренер группы: Роман. Если вы уже оплатили, напомните тренеру отметить оплату.',
        )
        expect(
            paymentReminderText({ ...base, coach: null, visits: [] }),
        ).not.toContain('Тренер')
    })

    it('caps the visit list at six', () => {
        const visits = Array.from({ length: 8 }, (_, i) =>
            at(`2026-10-${String(22 + i).padStart(2, '0')}`),
        )
        const text = paymentReminderText({ ...base, coach: null, visits })
        expect(text).toContain('22.10, 23.10, 24.10, 25.10, 26.10, 27.10 и ещё 2.')
    })
})
