import {
    isLiveMembership,
    localDateIn,
    overlapsLocalWindow,
    personName,
} from './my-agenda-utils'

describe('localDateIn', () => {
    it('reads the calendar day in the given zone', () => {
        const instant = new Date('2026-11-02T20:30:00.000Z')
        expect(localDateIn(instant, 'Europe/Moscow')).toBe('2026-11-02')
        expect(localDateIn(instant, 'Asia/Novosibirsk')).toBe('2026-11-03')
        expect(localDateIn(instant, 'America/New_York')).toBe('2026-11-02')
    })
})

describe('overlapsLocalWindow', () => {
    const span = (start: string, end: string, timezone: string) => ({
        start: new Date(start),
        end: new Date(end),
        timezone,
    })
    it('compares local days, inclusive on both ends', () => {
        const late = span('2026-11-08T18:00:00Z', '2026-11-08T19:00:00Z', 'Asia/Novosibirsk')
        // Local 2026-11-09 01:00 in Novosibirsk: outside a window ending the 8th.
        expect(overlapsLocalWindow(late, '2026-11-02', '2026-11-08')).toBe(false)
        expect(overlapsLocalWindow(late, '2026-11-09', '2026-11-15')).toBe(true)
    })
    it('keeps a multi-day span that started before the window', () => {
        const camp = span('2026-10-30T09:00:00Z', '2026-11-03T15:00:00Z', 'UTC')
        expect(overlapsLocalWindow(camp, '2026-11-02', '2026-11-08')).toBe(true)
    })
})

describe('personName', () => {
    it('prefers the trimmed full name, falls back to e-mail', () => {
        expect(personName({ firstname: ' Ann ', lastname: 'Lee', email: 'a@b.c' })).toBe('Ann Lee')
        expect(personName({ firstname: null, lastname: ' ', email: 'a@b.c' })).toBe('a@b.c')
    })
})

describe('isLiveMembership', () => {
    const now = new Date('2026-11-02T12:00:00Z')
    it('is live with no window, an open window, or as owner', () => {
        expect(isLiveMembership({ accessUntil: null, workspace: { ownerId: 'o' } }, 'u', now)).toBe(true)
        expect(
            isLiveMembership(
                { accessUntil: new Date('2026-11-03T00:00:00Z'), workspace: { ownerId: 'o' } },
                'u',
                now,
            ),
        ).toBe(true)
        expect(
            isLiveMembership(
                { accessUntil: new Date('2026-10-01T00:00:00Z'), workspace: { ownerId: 'u' } },
                'u',
                now,
            ),
        ).toBe(true)
    })
    it('is not live once the window lapsed', () => {
        expect(
            isLiveMembership(
                { accessUntil: new Date('2026-10-01T00:00:00Z'), workspace: { ownerId: 'o' } },
                'u',
                now,
            ),
        ).toBe(false)
    })
})
