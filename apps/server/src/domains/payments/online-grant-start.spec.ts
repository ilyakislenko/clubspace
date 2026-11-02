import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { onlineGrantStart, sameScopeAbonements } from './online-grant-start'

const GRAPPLING = vocabularyForWorkspaceType('GRAPPLING')
const DANCE = vocabularyForWorkspaceType('DANCE')

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
        expect(onlineGrantStart([], tz, now, GRAPPLING)).toEqual({ kind: 'now' })
        expect(
            onlineGrantStart([{ ...base, status: 'CANCELLED' }], tz, now, GRAPPLING),
        ).toEqual({ kind: 'now' })
        expect(
            onlineGrantStart(
                [{ ...base, endDate: new Date('2026-10-31T21:00:00Z') }],
                tz,
                now,
                GRAPPLING,
            ),
        ).toEqual({ kind: 'now' })
    })

    it('renews a live time-only abonement from the club-local day it ends', () => {
        expect(onlineGrantStart([base], tz, now, GRAPPLING)).toEqual({
            kind: 'renewal',
            fromYmd: '2026-11-15',
            // Moscow midnight of 15 Nov.
            startDate: new Date('2026-11-14T21:00:00Z'),
        })
    })

    it('renews from the latest end when several same-scope ones are live', () => {
        const later = { ...base, endDate: new Date('2026-11-20T21:00:00Z') }
        expect(onlineGrantStart([later, base], tz, now, GRAPPLING)).toMatchObject({
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
                GRAPPLING,
            ).kind,
        ).toBe('blocked')
    })

    it('starts now over a used-up class pack', () => {
        expect(
            onlineGrantStart(
                [{ ...base, classesTotal: 8, classesRemaining: 0 }],
                tz,
                now,
                GRAPPLING,
            ),
        ).toEqual({ kind: 'now' })
    })

    it('refuses over an abonement waiting for its first visit, in the club words', () => {
        const waiting = [{ ...base, startDate: null, endDate: null }]
        expect(onlineGrantStart(waiting, tz, now, GRAPPLING)).toEqual({
            kind: 'blocked',
            message: 'Ваш абонемент начнётся с первой тренировки — продлить его можно после начала',
        })
        expect(onlineGrantStart(waiting, tz, now, DANCE)).toEqual({
            kind: 'blocked',
            message: 'Ваш абонемент начнётся с первого занятия — продлить его можно после начала',
        })
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
