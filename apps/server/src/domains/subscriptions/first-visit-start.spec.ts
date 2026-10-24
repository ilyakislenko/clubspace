import { BadRequestError } from '../../shared/errors/shared.errors'
import { DAY_MS } from './freeze-dates'
import {
    abonementWindowEnd,
    clubDayStart,
    followAccessUntil,
    syncFirstVisitStartInTx,
} from './first-visit-start'

// Tomsk is UTC+7 with no DST.
const TZ = 'Asia/Tomsk'
const NOW = new Date('2026-10-24T10:00:00Z')

describe('clubDayStart', () => {
    it('is the club-local midnight of the instant’s day', () => {
        expect(clubDayStart(new Date('2026-10-24T10:00:00Z'), TZ)).toEqual(
            new Date('2026-10-23T17:00:00Z'),
        )
    })

    it('uses the club day, not the UTC day, late in the evening', () => {
        // 20:00Z is already 03:00 on the 25th in Tomsk.
        expect(clubDayStart(new Date('2026-10-24T20:00:00Z'), TZ)).toEqual(
            new Date('2026-10-24T17:00:00Z'),
        )
    })
})

describe('abonementWindowEnd', () => {
    it('is the endDate once the abonement started', () => {
        const endDate = new Date('2026-11-30T00:00:00Z')
        expect(
            abonementWindowEnd({ endDate, createdAt: NOW }, 30, TZ),
        ).toBe(endDate)
    })

    it('is the sale-day club midnight + duration while it waits', () => {
        expect(
            abonementWindowEnd({ endDate: null, createdAt: NOW }, 30, TZ),
        ).toEqual(new Date(new Date('2026-10-23T17:00:00Z').getTime() + 30 * DAY_MS))
    })
})

describe('followAccessUntil', () => {
    const before = new Date('2026-11-22T17:00:00Z')
    const after = new Date('2026-11-25T17:00:00Z')

    it('keeps a manual unlimited window final', () => {
        expect(followAccessUntil({ accessUntil: null, before, after })).toBeNull()
    })

    it('follows the abonement when accessUntil tracked it', () => {
        expect(followAccessUntil({ accessUntil: before, before, after })).toEqual(after)
        // ...also backwards, when the start moves earlier / un-starts.
        expect(
            followAccessUntil({ accessUntil: after, before: after, after: before }),
        ).toEqual(before)
    })

    it('extends a shorter manual window but never shortens a longer one', () => {
        const short = new Date('2026-11-01T00:00:00Z')
        const long = new Date('2027-01-01T00:00:00Z')
        expect(followAccessUntil({ accessUntil: short, before, after })).toEqual(after)
        expect(followAccessUntil({ accessUntil: long, before, after })).toEqual(long)
    })
})

describe('syncFirstVisitStartInTx', () => {
    const SALE = new Date('2026-10-24T05:00:00Z') // sale day club midnight = 10-23T17:00Z
    const PLAN_END = new Date(new Date('2026-10-23T17:00:00Z').getTime() + 30 * DAY_MS)

    const sub = (over: Record<string, unknown> = {}) => ({
        id: 's1',
        status: 'ACTIVE',
        startsOnFirstVisit: true,
        durationDays: 30,
        startDate: null,
        endDate: null,
        createdAt: SALE,
        plan: { durationDays: 30 },
        _count: { freezes: 0 },
        ...over,
    })
    const member = (over: Record<string, unknown> = {}, subOver?: Record<string, unknown>) => ({
        id: 'm1',
        accessUntil: PLAN_END,
        workspace: { timezone: TZ },
        subscription: sub(subOver),
        ...over,
    })

    const makeTx = (m: unknown, visitStartAt: Date | null) => ({
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(m),
            update: jest.fn().mockResolvedValue({}),
        },
        attendanceRecord: {
            findFirst: jest
                .fn()
                .mockResolvedValue(visitStartAt && { session: { startAt: visitStartAt } }),
        },
        subscription: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        subscriptionFreeze: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    })
    const run = (tx: ReturnType<typeof makeTx>) =>
        syncFirstVisitStartInTx(tx as never, {
            workspaceId: 'w1',
            userId: 'u1',
            now: NOW,
        })

    it('starts on the club day of the earliest qualifying visit', async () => {
        const visit = new Date('2026-10-26T12:00:00Z') // 19:00 Tomsk on the 26th
        const tx = makeTx(member(), visit)
        expect(await run(tx)).toBe('started')
        const start = new Date('2026-10-25T17:00:00Z')
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', status: 'ACTIVE', startDate: null },
            data: { startDate: start, endDate: new Date(start.getTime() + 30 * DAY_MS) },
        })
        // accessUntil tracked the provisional window, so it follows the real one.
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { accessUntil: new Date(start.getTime() + 30 * DAY_MS) },
        })
        expect(tx.subscriptionFreeze.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1', accessShifted: true },
            data: { accessShifted: false },
        })
    })

    it('only looks at visits from the sale-day midnight, not consumed by another pack', async () => {
        const tx = makeTx(member(), null)
        await run(tx)
        expect(tx.attendanceRecord.findFirst).toHaveBeenCalledWith({
            where: {
                workspaceId: 'w1',
                userId: 'u1',
                session: { startAt: { gte: new Date('2026-10-23T17:00:00Z') } },
                OR: [{ consumedSubscriptionId: null }, { consumedSubscriptionId: 's1' }],
            },
            orderBy: { session: { startAt: 'asc' } },
            select: { session: { select: { startAt: true } } },
        })
    })

    it('moves the start to an earlier visit', async () => {
        const oldStart = new Date('2026-10-25T17:00:00Z')
        const oldEnd = new Date(oldStart.getTime() + 30 * DAY_MS)
        const tx = makeTx(
            member({ accessUntil: oldEnd }, { startDate: oldStart, endDate: oldEnd }),
            new Date('2026-10-24T03:00:00Z'), // 10:00 Tomsk on the 24th
        )
        expect(await run(tx)).toBe('moved')
        const start = new Date('2026-10-23T17:00:00Z')
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', status: 'ACTIVE', startDate: oldStart },
            data: { startDate: start, endDate: new Date(start.getTime() + 30 * DAY_MS) },
        })
    })

    it('un-starts when no visit remains', async () => {
        const start = new Date('2026-10-25T17:00:00Z')
        const end = new Date(start.getTime() + 30 * DAY_MS)
        const tx = makeTx(
            member({ accessUntil: end }, { startDate: start, endDate: end }),
            null,
        )
        expect(await run(tx)).toBe('unstarted')
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', status: 'ACTIVE', startDate: start },
            data: { startDate: null, endDate: null },
        })
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { accessUntil: PLAN_END },
        })
    })

    it('is unchanged when the derived dates equal the stored ones', async () => {
        const start = new Date('2026-10-23T17:00:00Z')
        const end = new Date(start.getTime() + 30 * DAY_MS)
        const tx = makeTx(
            member({}, { startDate: start, endDate: end }),
            new Date('2026-10-24T03:00:00Z'),
        )
        expect(await run(tx)).toBe('unchanged')
        expect(tx.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('leaves a manual longer accessUntil alone', async () => {
        const long = new Date('2027-06-01T00:00:00Z')
        const tx = makeTx(member({ accessUntil: long }), new Date('2026-10-26T12:00:00Z'))
        expect(await run(tx)).toBe('started')
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(tx.subscriptionFreeze.updateMany).not.toHaveBeenCalled()
    })

    describe('does nothing when', () => {
        const visit = new Date('2026-10-26T12:00:00Z')
        const cases: Array<[string, unknown]> = [
            ['there is no member', null],
            ['there is no subscription', member({ subscription: null })],
            ['the abonement is not ACTIVE', member({}, { status: 'CANCELLED' })],
            ['the plan does not start on the first visit', member({}, { startsOnFirstVisit: false })],
            ['a freeze exists (start is locked)', member({}, { _count: { freezes: 1 } })],
            [
                'it has already expired',
                member(
                    {},
                    {
                        startDate: new Date('2026-09-01T00:00:00Z'),
                        endDate: new Date('2026-10-01T00:00:00Z'),
                    },
                ),
            ],
        ]
        it.each(cases)('%s', async (_name, m) => {
            const tx = makeTx(m, visit)
            expect(await run(tx)).toBe('unchanged')
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
            expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        })
    })

    it('falls back to the plan duration for rows from before durationDays existed', async () => {
        const tx = makeTx(
            member({}, { durationDays: null, plan: { durationDays: 10 } }),
            new Date('2026-10-26T12:00:00Z'),
        )
        await run(tx)
        const start = new Date('2026-10-25T17:00:00Z')
        expect(tx.subscription.updateMany.mock.calls[0][0].data.endDate).toEqual(
            new Date(start.getTime() + 10 * DAY_MS),
        )
    })

    it('re-runs once when the compare-and-set loses, then succeeds', async () => {
        const tx = makeTx(member(), new Date('2026-10-26T12:00:00Z'))
        tx.subscription.updateMany
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 1 })
        expect(await run(tx)).toBe('started')
        expect(tx.subscription.updateMany).toHaveBeenCalledTimes(2)
    })

    it('refuses when the compare-and-set loses twice', async () => {
        const tx = makeTx(member(), new Date('2026-10-26T12:00:00Z'))
        tx.subscription.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(tx)).rejects.toThrow(BadRequestError)
        expect(tx.subscription.updateMany).toHaveBeenCalledTimes(2)
    })
})
