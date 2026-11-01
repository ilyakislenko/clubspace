import { onlineGrantStart } from './online-grant-start'

const tz = 'Europe/Moscow'
const now = new Date('2026-11-01T09:00:00Z')
const base = {
    status: 'ACTIVE',
    startDate: new Date('2026-10-15T21:00:00Z'),
    endDate: new Date('2026-11-14T21:00:00Z'),
    classesTotal: null,
    classesRemaining: null,
}

describe('onlineGrantStart', () => {
    it('starts now without a live abonement', () => {
        expect(onlineGrantStart(null, tz, now)).toEqual({ kind: 'now' })
        expect(
            onlineGrantStart({ ...base, status: 'CANCELLED' }, tz, now),
        ).toEqual({ kind: 'now' })
        expect(
            onlineGrantStart(
                { ...base, endDate: new Date('2026-10-31T21:00:00Z') },
                tz,
                now,
            ),
        ).toEqual({ kind: 'now' })
    })

    it('renews a live time-only abonement from the club-local day it ends', () => {
        const out = onlineGrantStart(base, tz, now)
        expect(out).toEqual({
            kind: 'renewal',
            fromYmd: '2026-11-15',
            // Moscow midnight of 15 Nov.
            startDate: new Date('2026-11-14T21:00:00Z'),
        })
    })

    it('refuses while a live class pack has classes left', () => {
        const out = onlineGrantStart(
            { ...base, classesTotal: 8, classesRemaining: 3 },
            tz,
            now,
        )
        expect(out.kind).toBe('blocked')
    })

    it('starts now over a used-up class pack', () => {
        expect(
            onlineGrantStart(
                { ...base, classesTotal: 8, classesRemaining: 0 },
                tz,
                now,
            ),
        ).toEqual({ kind: 'now' })
    })

    it('refuses over an abonement waiting for its first visit', () => {
        expect(
            onlineGrantStart(
                { ...base, startDate: null, endDate: null },
                tz,
                now,
            ).kind,
        ).toBe('blocked')
    })
})
