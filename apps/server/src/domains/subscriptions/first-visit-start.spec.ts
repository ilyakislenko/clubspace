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
        durationDays: 30,
        startDate: null,
        endDate: null,
        createdAt: SALE,
        classesTotal: null,
        classesRemaining: null,
        plan: { durationDays: 30 },
        directions: [] as Array<{ directionId: string }>,
        ...over,
    })
    const member = (
        over: Record<string, unknown> = {},
        subs: unknown[] = [sub()],
    ) => ({
        id: 'm1',
        accessUntil: PLAN_END,
        workspace: { timezone: TZ },
        subscriptions: subs,
        ...over,
    })
    type Visit = {
        id: string
        consumedSubscriptionId: string | null
        session: { startAt: Date }
    }
    const visitRow = (startAt: Date, over: Partial<Visit> = {}): Visit => ({
        id: 'r1',
        consumedSubscriptionId: null,
        session: { startAt },
        ...over,
    })

    // `used`: the earliest visit attributed to each abonement id; `preSale`:
    // the unattributed sale-day visit the fallback query finds.
    const makeTx = (
        m: unknown,
        visits: { used?: Record<string, Visit>; preSale?: Visit | null } = {},
    ) => ({
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(m),
            update: jest.fn().mockResolvedValue({}),
        },
        attendanceRecord: {
            findFirst: jest.fn(
                async (args: {
                    where: { usedSubscriptionId: string | null }
                }): Promise<Visit | null> =>
                    args.where.usedSubscriptionId === null
                        ? (visits.preSale ?? null)
                        : (visits.used?.[args.where.usedSubscriptionId] ?? null),
            ),
            update: jest.fn().mockResolvedValue({}),
        },
        subscription: {
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
    const attributed = (startAt: Date, subId = 's1') => ({
        used: { [subId]: visitRow(startAt, { consumedSubscriptionId: subId }) },
    })

    it('loads only current, never-frozen first-visit abonements of the member', async () => {
        const tx = makeTx(member())
        await run(tx)
        const args = tx.workspaceMember.findFirst.mock.calls[0][0]
        expect(args.where).toEqual({ workspaceId: 'w1', userId: 'u1' })
        expect(args.select.subscriptions.where).toEqual({
            NOT: { workspaceMemberId: null },
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: NOW } }],
            startsOnFirstVisit: true,
            freezes: { none: {} },
        })
    })

    it('starts on the club day of the earliest visit attributed to it', async () => {
        const visit = new Date('2026-10-26T12:00:00Z') // 19:00 Tomsk on the 26th
        const tx = makeTx(member(), attributed(visit))
        expect(await run(tx)).toBe('started')
        expect(tx.attendanceRecord.findFirst).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1', usedSubscriptionId: 's1' },
            orderBy: { session: { startAt: 'asc' } },
            select: {
                id: true,
                consumedSubscriptionId: true,
                session: { select: { startAt: true } },
            },
        })
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
        // An attributed visit already paid: nothing re-tagged.
        expect(tx.attendanceRecord.update).not.toHaveBeenCalled()
    })

    it('with no attributed visit, looks for an unattributed sale-day visit marked before the sale', async () => {
        const tx = makeTx(member())
        await run(tx)
        expect(tx.attendanceRecord.findFirst).toHaveBeenLastCalledWith({
            where: {
                workspaceId: 'w1',
                userId: 'u1',
                usedSubscriptionId: null,
                markedAt: { lte: SALE },
                session: { startAt: { gte: SALE_START } },
            },
            orderBy: { session: { startAt: 'asc' } },
            select: {
                id: true,
                consumedSubscriptionId: true,
                session: { select: { startAt: true } },
            },
        })
    })

    it('a scoped abonement only takes a pre-sale visit of one of its directions', async () => {
        const tx = makeTx(
            member({}, [
                sub({ directions: [{ directionId: 'bjj' }, { directionId: 'mma' }] }),
            ]),
        )
        await run(tx)
        expect(tx.attendanceRecord.findFirst.mock.calls[1][0].where).toMatchObject({
            session: {
                startAt: { gte: SALE_START },
                OR: [
                    {
                        OR: [
                            { group: { directionId: 'bjj' } },
                            { workspaceEvent: { directionId: 'bjj' } },
                        ],
                    },
                    {
                        OR: [
                            { group: { directionId: 'mma' } },
                            { workspaceEvent: { directionId: 'mma' } },
                        ],
                    },
                ],
            },
        })
    })

    it('moves the start to an earlier visit', async () => {
        const oldStart = new Date('2026-10-25T17:00:00Z')
        const oldEnd = new Date(oldStart.getTime() + 30 * DAY_MS)
        const tx = makeTx(
            member({ accessUntil: oldEnd }, [sub({ startDate: oldStart, endDate: oldEnd })]),
            attributed(new Date('2026-10-24T03:00:00Z')), // 10:00 Tomsk on the 24th
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

    it('un-starts when no visit remains (un-marking the first visit re-derives)', async () => {
        const start = new Date('2026-10-25T17:00:00Z')
        const end = new Date(start.getTime() + 30 * DAY_MS)
        const tx = makeTx(
            member({ accessUntil: end }, [sub({ startDate: start, endDate: end })]),
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
            member({}, [sub({ startDate: start, endDate: end })]),
            attributed(new Date('2026-10-24T03:00:00Z')),
        )
        expect(await run(tx)).toBe('unchanged')
        expect(tx.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('keeps access an admin cut to today when a coach marks the first visit', async () => {
        const today = new Date('2026-10-24T00:00:00Z')
        const tx = makeTx(
            member({ accessUntil: today }),
            attributed(new Date('2026-10-26T12:00:00Z')),
        )
        expect(await run(tx)).toBe('started')
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(tx.subscriptionFreeze.updateMany).not.toHaveBeenCalled()
    })

    it('leaves a manual longer accessUntil alone', async () => {
        const long = new Date('2027-06-01T00:00:00Z')
        const tx = makeTx(
            member({ accessUntil: long }),
            attributed(new Date('2026-10-26T12:00:00Z')),
        )
        expect(await run(tx)).toBe('started')
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(tx.subscriptionFreeze.updateMany).not.toHaveBeenCalled()
    })

    describe('the auto-start deadline', () => {
        // Sale-day club midnight + 14 days.
        const DEADLINE = new Date(SALE_START.getTime() + 14 * DAY_MS)

        it('starts by itself on the deadline when nobody came', async () => {
            const tx = makeTx(member())
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
            const tx = makeTx(member())
            expect(await run(tx, new Date(DEADLINE.getTime() - 60_000))).toBe('unchanged')
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
        })

        it('lets an earlier visit win', async () => {
            const tx = makeTx(member(), attributed(new Date('2026-10-28T12:00:00Z')))
            const now = new Date(DEADLINE.getTime() + DAY_MS)
            expect(await run(tx, now)).toBe('started')
            expect(tx.subscription.updateMany.mock.calls[0][0].data.startDate).toEqual(
                new Date('2026-10-27T17:00:00Z'),
            )
        })

        it('prefers the deadline to a visit that comes after it', async () => {
            const tx = makeTx(member(), attributed(new Date('2026-11-09T12:00:00Z')))
            const now = new Date(DEADLINE.getTime() + 3 * DAY_MS)
            expect(await run(tx, now)).toBe('started')
            expect(tx.subscription.updateMany.mock.calls[0][0].data.startDate).toEqual(
                DEADLINE,
            )
        })

        it('is idempotent once started on the deadline', async () => {
            const end = new Date(DEADLINE.getTime() + 30 * DAY_MS)
            const tx = makeTx(
                member({ accessUntil: end }, [sub({ startDate: DEADLINE, endDate: end })]),
            )
            expect(await run(tx, new Date(DEADLINE.getTime() + 5 * DAY_MS))).toBe('unchanged')
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
        })
    })

    describe('a visit marked on the sale day before the sale', () => {
        const visit = new Date('2026-10-24T03:00:00Z') // 10:00 Tomsk, sale at 12:00
        const pack = { classesTotal: 8, classesRemaining: 8 }

        it('starts it, is attributed to it and pays the first class of a pack', async () => {
            const tx = makeTx(member({}, [sub(pack)]), { preSale: visitRow(visit) })
            expect(await run(tx)).toBe('started')
            expect(tx.subscription.updateMany.mock.calls[0][0].data.startDate).toEqual(
                SALE_START,
            )
            expect(tx.subscription.updateMany).toHaveBeenLastCalledWith({
                where: { id: 's1', classesRemaining: { gt: 0 } },
                data: { classesRemaining: { decrement: 1 } },
            })
            // Un-marking refunds through consumedSubscriptionId.
            expect(tx.attendanceRecord.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { usedSubscriptionId: 's1', consumedSubscriptionId: 's1' },
            })
        })

        it.each([
            ['the pack has no classes left', { classesTotal: 8, classesRemaining: 0 }],
            ['the tariff is time-only', { classesTotal: null, classesRemaining: null }],
        ])('only attributes it when %s', async (_name, over) => {
            const tx = makeTx(member({}, [sub(over)]), { preSale: visitRow(visit) })
            await run(tx)
            expect(tx.subscription.updateMany).toHaveBeenCalledTimes(1)
            expect(tx.attendanceRecord.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { usedSubscriptionId: 's1' },
            })
        })

        it('only attributes it when the class was taken by someone else in the meantime', async () => {
            const tx = makeTx(member({}, [sub(pack)]), { preSale: visitRow(visit) })
            tx.subscription.updateMany
                .mockResolvedValueOnce({ count: 1 })
                .mockResolvedValueOnce({ count: 0 })
            await run(tx)
            expect(tx.attendanceRecord.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { usedSubscriptionId: 's1' },
            })
        })

        it('still attributes it when the dates already match', async () => {
            const end = new Date(SALE_START.getTime() + 30 * DAY_MS)
            const tx = makeTx(
                member({ accessUntil: end }, [sub({ startDate: SALE_START, endDate: end })]),
                { preSale: visitRow(visit) },
            )
            expect(await run(tx)).toBe('unchanged')
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
            expect(tx.attendanceRecord.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { usedSubscriptionId: 's1' },
            })
        })

        it('takes nothing when the deadline, not a visit, started it', async () => {
            const tx = makeTx(member({}, [sub(pack)]))
            await run(tx, new Date(SALE_START.getTime() + 15 * DAY_MS))
            expect(tx.subscription.updateMany).toHaveBeenCalledTimes(1)
            expect(tx.attendanceRecord.update).not.toHaveBeenCalled()
        })
    })

    describe('several pending abonements', () => {
        const clubWide = sub({ id: 'club' })
        const bjj = sub({ id: 'bjj-pack', directions: [{ directionId: 'bjj' }] })
        const visit = new Date('2026-10-26T12:00:00Z')

        it('a BJJ visit spent on the BJJ pack does not start the club-wide one', async () => {
            const tx = makeTx(member({}, [clubWide, bjj]), attributed(visit, 'bjj-pack'))
            expect(await run(tx)).toBe('started')
            expect(tx.subscription.updateMany).toHaveBeenCalledTimes(1)
            expect(tx.subscription.updateMany.mock.calls[0][0].where.id).toBe('bjj-pack')
        })

        it('handles each one and reports the most significant change', async () => {
            const oldStart = new Date('2026-10-27T17:00:00Z')
            const oldEnd = new Date(oldStart.getTime() + 30 * DAY_MS)
            const tx = makeTx(
                member({}, [sub({ id: 'club', startDate: oldStart, endDate: oldEnd }), bjj]),
                {
                    used: {
                        club: visitRow(visit, { id: 'r-club' }),
                        'bjj-pack': visitRow(visit, { id: 'r-bjj' }),
                    },
                },
            )
            expect(await run(tx)).toBe('started')
            // Narrowest first; the club-wide one moved, the БЖЖ one started.
            expect(
                tx.subscription.updateMany.mock.calls.map((c) => c[0].where.id),
            ).toEqual(['bjj-pack', 'club'])
        })

        it('the narrowest one claims a pre-sale visit first', async () => {
            const preSale = visitRow(new Date('2026-10-24T03:00:00Z'))
            const tx = makeTx(member({}, [clubWide, bjj]))
            // Once claimed it is no longer unattributed.
            tx.attendanceRecord.findFirst
                .mockResolvedValueOnce(null) // bjj-pack: attributed
                .mockResolvedValueOnce(preSale) // bjj-pack: pre-sale
            await run(tx)
            expect(tx.attendanceRecord.update).toHaveBeenCalledTimes(1)
            expect(tx.attendanceRecord.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { usedSubscriptionId: 'bjj-pack' },
            })
        })
    })

    it('does nothing without a member or a pending abonement', async () => {
        for (const m of [null, member({}, [])]) {
            const tx = makeTx(m, attributed(new Date('2026-10-26T12:00:00Z')))
            expect(await run(tx)).toBe('unchanged')
            expect(tx.attendanceRecord.findFirst).not.toHaveBeenCalled()
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
            expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        }
    })

    it('falls back to the plan duration for rows from before durationDays existed', async () => {
        const tx = makeTx(
            member({}, [sub({ durationDays: null, plan: { durationDays: 10 } })]),
            attributed(new Date('2026-10-26T12:00:00Z')),
        )
        await run(tx)
        const start = new Date('2026-10-25T17:00:00Z')
        expect(tx.subscription.updateMany.mock.calls[0][0].data.endDate).toEqual(
            new Date(start.getTime() + 10 * DAY_MS),
        )
    })

    it('re-runs once when the compare-and-set loses, then succeeds', async () => {
        const tx = makeTx(member(), attributed(new Date('2026-10-26T12:00:00Z')))
        tx.subscription.updateMany
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 1 })
        expect(await run(tx)).toBe('started')
        expect(tx.subscription.updateMany).toHaveBeenCalledTimes(2)
    })

    it('refuses when the compare-and-set loses twice', async () => {
        const tx = makeTx(member(), attributed(new Date('2026-10-26T12:00:00Z')))
        tx.subscription.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(tx)).rejects.toThrow(BadRequestError)
        expect(tx.subscription.updateMany).toHaveBeenCalledTimes(2)
    })
})
