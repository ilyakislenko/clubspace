import { BadRequestError } from '../../shared/errors/shared.errors'
import { DAY_MS } from './freeze-dates'
import {
    FIRST_VISIT_AUTO_START_DAYS,
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

    it('is the latest auto-start (sale-day club midnight + 14 days) + duration while it waits', () => {
        expect(FIRST_VISIT_AUTO_START_DAYS).toBe(14)
        expect(
            abonementWindowEnd({ endDate: null, createdAt: NOW }, 30, TZ),
        ).toEqual(new Date(new Date('2026-10-23T17:00:00Z').getTime() + 44 * DAY_MS))
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

    it('never undoes a window an admin cut shorter than the abonement', () => {
        const short = new Date('2026-11-01T00:00:00Z')
        expect(followAccessUntil({ accessUntil: short, before, after })).toEqual(short)
        // ...also when the new window is shorter than the old one.
        expect(
            followAccessUntil({ accessUntil: short, before: after, after: before }),
        ).toEqual(short)
    })

    it('extends a longer manual window only when the abonement now outlasts it', () => {
        const longer = new Date('2026-11-24T00:00:00Z') // past before, short of after
        const long = new Date('2027-01-01T00:00:00Z')
        expect(followAccessUntil({ accessUntil: longer, before, after })).toEqual(after)
        expect(followAccessUntil({ accessUntil: long, before, after })).toEqual(long)
    })
})

describe('syncFirstVisitStartInTx', () => {
    const SALE = new Date('2026-10-24T05:00:00Z') // sale day club midnight = 10-23T17:00Z
    const SALE_START = new Date('2026-10-23T17:00:00Z')
    // Provisional window: auto-start deadline (14 days) + the term.
    const PLAN_END = new Date(SALE_START.getTime() + 44 * DAY_MS)

    const sub = (over: Record<string, unknown> = {}) => ({
        id: 's1',
        status: 'ACTIVE',
        startsOnFirstVisit: true,
        durationDays: 30,
        startDate: null,
        endDate: null,
        createdAt: SALE,
        classesTotal: null,
        classesRemaining: null,
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

    const makeTx = (
        m: unknown,
        visitStartAt: Date | null,
        visitOver: Record<string, unknown> = {},
    ) => ({
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(m),
            update: jest.fn().mockResolvedValue({}),
        },
        attendanceRecord: {
            findFirst: jest.fn().mockResolvedValue(
                visitStartAt && {
                    id: 'r1',
                    consumedSubscriptionId: 's1',
                    session: { startAt: visitStartAt },
                    ...visitOver,
                },
            ),
            update: jest.fn().mockResolvedValue({}),
        },
        subscription: {
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        subscriptionFreeze: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    })
    const run = (tx: ReturnType<typeof makeTx>, now: Date = NOW) =>
        syncFirstVisitStartInTx(tx as never, {
            workspaceId: 'w1',
            userId: 'u1',
            now,
        })

    it('starts on the club day of the earliest qualifying visit', async () => {
        const visit = new Date('2026-10-26T12:00:00Z') // 19:00 Tomsk on the 26th
        const tx = makeTx(member(), visit)
        expect(await run(tx)).toBe('started')
        const start = new Date('2026-10-25T17:00:00Z')
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: {
                id: 's1',
                status: 'ACTIVE',
                startDate: null,
                endDate: null,
                freezes: { none: {} },
            },
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
            select: {
                id: true,
                consumedSubscriptionId: true,
                session: { select: { startAt: true } },
            },
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
            where: {
                id: 's1',
                status: 'ACTIVE',
                startDate: oldStart,
                endDate: oldEnd,
                freezes: { none: {} },
            },
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
            where: {
                id: 's1',
                status: 'ACTIVE',
                startDate: start,
                endDate: end,
                freezes: { none: {} },
            },
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

    it('keeps access an admin cut to today when a coach marks the first visit', async () => {
        const today = new Date('2026-10-24T00:00:00Z')
        const tx = makeTx(member({ accessUntil: today }), new Date('2026-10-26T12:00:00Z'))
        expect(await run(tx)).toBe('started')
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(tx.subscriptionFreeze.updateMany).not.toHaveBeenCalled()
    })

    it('leaves a manual longer accessUntil alone', async () => {
        const long = new Date('2027-06-01T00:00:00Z')
        const tx = makeTx(member({ accessUntil: long }), new Date('2026-10-26T12:00:00Z'))
        expect(await run(tx)).toBe('started')
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(tx.subscriptionFreeze.updateMany).not.toHaveBeenCalled()
    })

    describe('the auto-start deadline', () => {
        // Sale-day club midnight + 14 days.
        const DEADLINE = new Date(SALE_START.getTime() + 14 * DAY_MS)

        it('starts by itself on the deadline when nobody came', async () => {
            const tx = makeTx(member(), null)
            expect(await run(tx, DEADLINE)).toBe('started')
            expect(tx.subscription.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 's1',
                    status: 'ACTIVE',
                    startDate: null,
                    endDate: null,
                    freezes: { none: {} },
                },
                data: {
                    startDate: DEADLINE,
                    endDate: new Date(DEADLINE.getTime() + 30 * DAY_MS),
                },
            })
            // The provisional window was already deadline + term: access is unchanged.
            expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        })

        it('keeps waiting until the deadline', async () => {
            const tx = makeTx(member(), null)
            expect(await run(tx, new Date(DEADLINE.getTime() - 60_000))).toBe('unchanged')
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
        })

        it('lets an earlier visit win', async () => {
            const tx = makeTx(member(), new Date('2026-10-28T12:00:00Z'))
            const now = new Date(DEADLINE.getTime() + DAY_MS)
            expect(await run(tx, now)).toBe('started')
            expect(tx.subscription.updateMany.mock.calls[0][0].data.startDate).toEqual(
                new Date('2026-10-27T17:00:00Z'),
            )
        })

        it('prefers the deadline to a visit that comes after it', async () => {
            const tx = makeTx(member(), new Date('2026-11-09T12:00:00Z'))
            const now = new Date(DEADLINE.getTime() + 3 * DAY_MS)
            expect(await run(tx, now)).toBe('started')
            expect(tx.subscription.updateMany.mock.calls[0][0].data.startDate).toEqual(
                DEADLINE,
            )
        })

        it('is idempotent once started on the deadline', async () => {
            const end = new Date(DEADLINE.getTime() + 30 * DAY_MS)
            const tx = makeTx(
                member({ accessUntil: end }, { startDate: DEADLINE, endDate: end }),
                null,
            )
            expect(await run(tx, new Date(DEADLINE.getTime() + 5 * DAY_MS))).toBe('unchanged')
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
        })
    })

    describe('which visits qualify', () => {
        it('ignores visits inside the previous abonement’s term', async () => {
            const tx = makeTx(member(), null)
            const prevEnd = new Date('2026-10-30T17:00:00Z')
            tx.subscription.findFirst.mockResolvedValue({ endDate: prevEnd })
            await run(tx)
            expect(tx.subscription.findFirst).toHaveBeenCalledWith({
                where: {
                    workspaceMemberId: 'm1',
                    id: { not: 's1' },
                    status: 'ACTIVE',
                    endDate: { not: null },
                },
                orderBy: { createdAt: 'desc' },
                select: { endDate: true },
            })
            expect(
                tx.attendanceRecord.findFirst.mock.calls[0][0].where.session,
            ).toEqual({ startAt: { gte: prevEnd } })
        })

        it('uses the sale-day midnight when the previous abonement ended before it', async () => {
            const tx = makeTx(member(), null)
            tx.subscription.findFirst.mockResolvedValue({
                endDate: new Date('2026-10-01T00:00:00Z'),
            })
            await run(tx)
            expect(
                tx.attendanceRecord.findFirst.mock.calls[0][0].where.session,
            ).toEqual({ startAt: { gte: SALE_START } })
        })
    })

    describe('the first training of a class pack', () => {
        const pack = { classesTotal: 8, classesRemaining: 8 }
        const visit = new Date('2026-10-26T12:00:00Z')

        it('takes a class when the visit was marked before the sale', async () => {
            const tx = makeTx(member({}, pack), visit, { consumedSubscriptionId: null })
            expect(await run(tx)).toBe('started')
            expect(tx.subscription.updateMany).toHaveBeenLastCalledWith({
                where: { id: 's1', classesRemaining: { gt: 0 } },
                data: { classesRemaining: { decrement: 1 } },
            })
            // Un-marking refunds through this tag.
            expect(tx.attendanceRecord.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { consumedSubscriptionId: 's1' },
            })
        })

        it('does not take a second class for a visit that already paid for one', async () => {
            const tx = makeTx(member({}, pack), visit)
            await run(tx)
            expect(tx.subscription.updateMany).toHaveBeenCalledTimes(1)
            expect(tx.attendanceRecord.update).not.toHaveBeenCalled()
        })

        it.each([
            ['the pack has no classes left', { classesTotal: 8, classesRemaining: 0 }],
            ['the tariff is time-only', { classesTotal: null, classesRemaining: null }],
        ])('takes nothing when %s', async (_name, over) => {
            const tx = makeTx(member({}, over), visit, { consumedSubscriptionId: null })
            await run(tx)
            expect(tx.subscription.updateMany).toHaveBeenCalledTimes(1)
            expect(tx.attendanceRecord.update).not.toHaveBeenCalled()
        })

        it('tags nothing when the class was taken by someone else in the meantime', async () => {
            const tx = makeTx(member({}, pack), visit, { consumedSubscriptionId: null })
            tx.subscription.updateMany
                .mockResolvedValueOnce({ count: 1 })
                .mockResolvedValueOnce({ count: 0 })
            await run(tx)
            expect(tx.attendanceRecord.update).not.toHaveBeenCalled()
        })

        it('takes nothing when the deadline, not a visit, started it', async () => {
            const tx = makeTx(member({}, pack), null)
            await run(tx, new Date(SALE_START.getTime() + 15 * DAY_MS))
            expect(tx.subscription.updateMany).toHaveBeenCalledTimes(1)
        })
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
