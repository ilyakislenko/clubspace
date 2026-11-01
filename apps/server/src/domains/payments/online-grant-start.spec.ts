import { onlineGrantStart, sameScopeAbonements } from './online-grant-start'

const tz = 'Europe/Moscow'
const now = new Date('2026-11-01T09:00:00Z')
const base = {
    status: 'ACTIVE',
    startDate: new Date('2026-10-15T21:00:00Z'),
    endDate: new Date('2026-11-14T21:00:00Z'),
    classesTotal: null as number | null,
    classesRemaining: null as number | null,
}

describe('onlineGrantStart', () => {
    it('starts now without a live abonement', () => {
        expect(onlineGrantStart([], tz, now)).toEqual({ kind: 'now' })
        expect(
            onlineGrantStart([{ ...base, status: 'CANCELLED' }], tz, now),
        ).toEqual({ kind: 'now' })
        expect(
            onlineGrantStart(
                [{ ...base, endDate: new Date('2026-10-31T21:00:00Z') }],
                tz,
                now,
            ),
        ).toEqual({ kind: 'now' })
    })

    it('renews a live time-only abonement from the club-local day it ends', () => {
        expect(onlineGrantStart([base], tz, now)).toEqual({
            kind: 'renewal',
            fromYmd: '2026-11-15',
            // Moscow midnight of 15 Nov.
            startDate: new Date('2026-11-14T21:00:00Z'),
        })
    })

    it('renews from the latest end when several same-scope ones are live', () => {
        const later = { ...base, endDate: new Date('2026-11-20T21:00:00Z') }
        expect(onlineGrantStart([later, base], tz, now)).toMatchObject({
            kind: 'renewal',
            fromYmd: '2026-11-21',
        })
    })

    it('refuses while a live class pack has classes left', () => {
        expect(
            onlineGrantStart(
                [base, { ...base, classesTotal: 8, classesRemaining: 3 }],
                tz,
                now,
            ).kind,
        ).toBe('blocked')
    })

    it('starts now over a used-up class pack', () => {
        expect(
            onlineGrantStart(
                [{ ...base, classesTotal: 8, classesRemaining: 0 }],
                tz,
                now,
            ),
        ).toEqual({ kind: 'now' })
    })

    it('refuses over an abonement waiting for its first visit', () => {
        expect(
            onlineGrantStart([{ ...base, startDate: null, endDate: null }], tz, now)
                .kind,
        ).toBe('blocked')
    })
})

describe('sameScopeAbonements', () => {
    const scoped = (...ids: string[]) => ({
        id: ids.join('+') || 'club',
        directions: ids.map((directionId) => ({ directionId })),
    })

    it('keeps only abonements with exactly the tariff scope (order-insensitive)', () => {
        const all = [scoped(), scoped('bjj'), scoped('bjj', 'muay'), scoped('muay', 'bjj')]
        expect(sameScopeAbonements(all, []).map((s) => s.id)).toEqual(['club'])
        expect(sameScopeAbonements(all, ['bjj']).map((s) => s.id)).toEqual(['bjj'])
        expect(sameScopeAbonements(all, ['bjj', 'muay']).map((s) => s.id)).toEqual([
            'bjj+muay',
            'muay+bjj',
        ])
    })
})
