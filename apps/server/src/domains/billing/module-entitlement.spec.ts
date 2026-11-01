import { moduleEntitlement } from './module-entitlement'
import { viewedSecondsSinceLastSave } from './video-usage'

const now = new Date('2026-11-10T12:00:00.000Z')
const active = { status: 'ACTIVE' as const }
const trial = { status: 'TRIAL' as const }

describe('moduleEntitlement', () => {
    it('the trial turns every module on; afterwards it is off by default', () => {
        expect(moduleEntitlement(null, trial, now, true)).toEqual({ entitled: true, source: 'TRIAL' })
        expect(moduleEntitlement(null, null, now, true)).toEqual({ entitled: true, source: 'TRIAL' })
        expect(moduleEntitlement(null, active, now, true)).toEqual({ entitled: false, source: 'NONE' })
        expect(moduleEntitlement(null, { status: 'PAST_DUE' }, now, true).entitled).toBe(false)
    })

    it('paid is on; comp is on until its date, then off', () => {
        expect(moduleEntitlement({ mode: 'PAID', compUntil: null }, active, now, true)).toEqual({
            entitled: true,
            source: 'PAID',
        })
        expect(
            moduleEntitlement(
                { mode: 'COMP', compUntil: new Date('2026-12-01Z') },
                active,
                now,
                true,
            ),
        ).toEqual({ entitled: true, source: 'COMP' })
        expect(
            moduleEntitlement(
                { mode: 'COMP', compUntil: new Date('2026-11-01Z') },
                active,
                now,
                true,
            ),
        ).toEqual({ entitled: false, source: 'NONE' })
    })

    it('OFF wins even during the trial; a self-hosted install has everything', () => {
        expect(moduleEntitlement({ mode: 'OFF', compUntil: null }, trial, now, true)).toEqual({
            entitled: false,
            source: 'OFF',
        })
        expect(moduleEntitlement({ mode: 'OFF', compUntil: null }, active, now, false)).toEqual({
            entitled: true,
            source: 'SELF_HOSTED',
        })
    })
})

describe('viewedSecondsSinceLastSave (VIDEO metering)', () => {
    const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000)

    it('counts forward playback between two saves', () => {
        expect(viewedSecondsSinceLastSave({ position: 100, watchedAt: at(15) }, 115, now)).toBe(15)
    })

    it('caps a forward seek by the time that passed (2× speed + slack)', () => {
        expect(viewedSecondsSinceLastSave({ position: 0, watchedAt: at(10) }, 1_800, now)).toBe(50)
    })

    it('a seek back or a replay counts nothing', () => {
        expect(viewedSecondsSinceLastSave({ position: 600, watchedAt: at(10) }, 5, now)).toBe(0)
    })

    it('the first save of a video counts at most a minute', () => {
        expect(viewedSecondsSinceLastSave(null, 12, now)).toBe(12)
        expect(viewedSecondsSinceLastSave(null, 900, now)).toBe(60)
    })
})
