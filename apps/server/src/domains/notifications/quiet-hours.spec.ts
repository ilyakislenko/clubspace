import { isQuietHour, nextSendAt } from './quiet-hours'

// Asia/Tomsk is UTC+7 all year; America/New_York is UTC−5 / UTC−4 (DST).
describe('quiet hours', () => {
    it.each([
        ['2026-11-26T14:59:00Z', false], // 21:59 Tomsk
        ['2026-11-26T15:00:00Z', true], // 22:00
        ['2026-11-26T01:59:00Z', true], // 08:59
        ['2026-11-26T02:00:00Z', false], // 09:00
    ])('Asia/Tomsk at %s → quiet %s', (iso, quiet) => {
        expect(isQuietHour(new Date(iso), 'Asia/Tomsk')).toBe(quiet)
    })

    it.each([
        ['2026-11-27T02:59:00Z', false], // 21:59 New York (EST)
        ['2026-11-27T03:00:00Z', true], // 22:00
        ['2026-11-26T13:59:00Z', true], // 08:59
        ['2026-11-26T14:00:00Z', false], // 09:00
    ])('America/New_York at %s → quiet %s', (iso, quiet) => {
        expect(isQuietHour(new Date(iso), 'America/New_York')).toBe(quiet)
    })

    it('keeps a time outside quiet hours as it is', () => {
        const noon = new Date('2026-11-26T05:00:00Z') // 12:00 Tomsk
        expect(nextSendAt(noon, 'Asia/Tomsk')).toBe(noon)
    })

    it('moves 23:00 to 09:00 of the next club day, across midnight', () => {
        // 23:00 Tomsk on the 26th → 09:00 Tomsk on the 27th.
        expect(nextSendAt(new Date('2026-11-26T16:00:00Z'), 'Asia/Tomsk').toISOString()).toBe(
            '2026-11-27T02:00:00.000Z',
        )
        // 23:30 New York on the 26th is 04:30Z on the 27th → 09:00 EST on the 27th.
        expect(nextSendAt(new Date('2026-11-27T04:30:00Z'), 'America/New_York').toISOString()).toBe(
            '2026-11-27T14:00:00.000Z',
        )
    })

    it('moves an early-morning time to 09:00 of the same club day', () => {
        // 02:00 Tomsk on the 27th (19:00Z on the 26th) → 09:00 Tomsk on the 27th.
        expect(nextSendAt(new Date('2026-11-26T19:00:00Z'), 'Asia/Tomsk').toISOString()).toBe(
            '2026-11-27T02:00:00.000Z',
        )
    })

    it('lands on 09:00 local across a DST change', () => {
        // New York leaves DST on 2026-11-01 at 02:00: 23:00 EDT on Oct 31
        // (03:00Z Nov 1) → 09:00 EST on Nov 1 = 14:00Z (not 13:00Z).
        expect(nextSendAt(new Date('2026-11-01T03:00:00Z'), 'America/New_York').toISOString()).toBe(
            '2026-11-01T14:00:00.000Z',
        )
        // Spring forward 2026-03-08: 23:00 EST on Mar 7 (04:00Z Mar 8) →
        // 09:00 EDT on Mar 8 = 13:00Z.
        expect(nextSendAt(new Date('2026-03-08T04:00:00Z'), 'America/New_York').toISOString()).toBe(
            '2026-03-08T13:00:00.000Z',
        )
    })
})
