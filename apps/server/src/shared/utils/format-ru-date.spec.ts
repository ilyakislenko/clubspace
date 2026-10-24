import { formatRuDate } from './format-ru-date'

describe('formatRuDate', () => {
    it('formats a calendar day in Russian', () => {
        expect(formatRuDate(new Date('2026-05-08T00:00:00Z'), 'UTC')).toBe(
            '8 мая',
        )
    })

    it('renders the day in the given timezone', () => {
        const instant = new Date('2026-05-08T22:30:00Z')
        expect(formatRuDate(instant, 'UTC')).toBe('8 мая')
        expect(formatRuDate(instant, 'Europe/Moscow')).toBe('9 мая')
    })
})
