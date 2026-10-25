import { BadRequestError } from '../../../shared/errors/shared.errors'
import { syncFirstVisitStartInTx } from '../first-visit-start'
import { SubscriptionService } from './subscription.service'

jest.mock('../first-visit-start', () => ({
    ...jest.requireActual('../first-visit-start'),
    syncFirstVisitStartInTx: jest.fn().mockResolvedValue('unchanged'),
}))

beforeEach(() => (syncFirstVisitStartInTx as jest.Mock).mockClear())

const makeTx = () => ({
    plan: { findFirst: jest.fn() },
    workspaceMember: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    subscription: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: 's1', ...data })),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    subscriptionFreeze: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
    },
})
const makePrisma = (tx: ReturnType<typeof makeTx>) => ({
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
})
const svcWith = (tx: ReturnType<typeof makeTx>) =>
    new SubscriptionService(makePrisma(tx) as never)

describe('grantFromPlan', () => {
    const plan = { id: 'p1', price: 5000, currency: 'RUB', durationDays: 30 }

    it('creates a subscription with endDate = start + durationDays and extends accessUntil', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({ id: 'm1', accessUntil: null })
        const res = await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
        })
        const data = tx.subscription.create.mock.calls[0][0].data
        expect(data.endDate.toISOString()).toBe('2026-07-31T00:00:00.000Z')
        expect(data.amountPaid).toBe(5000)
        expect(data.currency).toBe('RUB')
        expect(data.source).toBe('MANUAL')
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { subscriptionId: 's1', accessUntil: data.endDate },
        })
        expect(res.accessUntil.toISOString()).toBe('2026-07-31T00:00:00.000Z')
    })

    it('records a sale as paid by default and stamps paidAt', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({ id: 'm1', accessUntil: null })
        const now = new Date('2026-07-01T09:00:00Z')
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: now,
            now,
        })
        const data = tx.subscription.create.mock.calls[0][0].data
        expect(data.isPaid).toBe(true)
        expect(data.paidAt).toEqual(now)
    })

    it('records an unpaid sale with no paidAt', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({ id: 'm1', accessUntil: null })
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
            paid: false,
        })
        const data = tx.subscription.create.mock.calls[0][0].data
        expect(data.isPaid).toBe(false)
        expect(data.paidAt).toBeNull()
        expect(data.amountPaid).toBe(5000)
    })

    it('clears accessShifted on old freezes when it writes a new access window', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            userId: 'u1',
            accessUntil: new Date('2026-06-15T00:00:00Z'),
        })
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
        })
        expect(tx.subscriptionFreeze.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1', accessShifted: true },
            data: { accessShifted: false },
        })
    })

    it('leaves old freezes alone when accessUntil does not change', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            userId: 'u1',
            accessUntil: new Date('2026-12-31T00:00:00Z'),
        })
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
        })
        expect(tx.subscriptionFreeze.updateMany).not.toHaveBeenCalled()
    })

    it('does not shorten a longer existing accessUntil', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        const later = new Date('2026-12-31T00:00:00Z')
        tx.workspaceMember.findFirst.mockResolvedValue({ id: 'm1', accessUntil: later })
        const res = await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
        })
        expect(res.accessUntil).toBe(later)
    })

    it('respects an explicit amountPaid (comped = 0)', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({ id: 'm1', accessUntil: null })
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
            amountPaid: 0,
        })
        expect(tx.subscription.create.mock.calls[0][0].data.amountPaid).toBe(0)
    })

    it('seeds the class-pack balance from plan.classCount', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue({ ...plan, classCount: 8 })
        tx.workspaceMember.findFirst.mockResolvedValue({ id: 'm1', accessUntil: null })
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
        })
        const data = tx.subscription.create.mock.calls[0][0].data
        expect(data.classesTotal).toBe(8)
        expect(data.classesRemaining).toBe(8)
    })

    it('refuses a second free trial for the same member', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue({ ...plan, isFreeTrial: true })
        tx.workspaceMember.findFirst.mockResolvedValue({ id: 'm1', accessUntil: null })
        // Member already used a free-trial plan.
        tx.subscription.findFirst.mockResolvedValue({ id: 'prev' })
        await expect(
            svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                startDate: new Date(),
            }),
        ).rejects.toThrow(/Пробное занятие уже использовано/i)
        expect(tx.subscription.create).not.toHaveBeenCalled()
    })

    // Regression: granting on top of a live abonement used to create a second
    // ACTIVE row and repoint the member at it, so the previous pack's remaining
    // classes became invisible and unspendable while still counting as revenue.
    it('refuses to stack a second abonement on a live class pack', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            accessUntil: null,
            workspace: { timezone: 'Asia/Tomsk' },
            subscription: {
                status: 'ACTIVE',
                endDate: new Date('2026-12-31T00:00:00Z'),
                classesRemaining: 7,
                classesTotal: 12,
                plan: { name: 'лимит 12' },
            },
        })
        await expect(
            svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                startDate: new Date('2026-07-01T00:00:00Z'),
            }),
        ).rejects.toThrow(/уже есть действующий абонемент/)
        expect(tx.subscription.create).not.toHaveBeenCalled()
    })

    it('names the remaining balance so the admin knows what they would destroy', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            accessUntil: null,
            workspace: { timezone: 'Asia/Tomsk' },
            subscription: {
                status: 'ACTIVE',
                endDate: new Date('2026-12-31T00:00:00Z'),
                classesRemaining: 7,
                classesTotal: 12,
                plan: { name: 'лимит 12' },
            },
        })
        await expect(
            svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                startDate: new Date('2026-07-01T00:00:00Z'),
            }),
        ).rejects.toThrow(/«лимит 12», осталось 7 из 12/)
    })

    it('allows a new abonement once the previous one has expired', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            accessUntil: null,
            workspace: { timezone: 'Asia/Tomsk' },
            subscription: {
                status: 'ACTIVE',
                endDate: new Date('2026-06-01T00:00:00Z'),
                classesRemaining: 3,
                classesTotal: 12,
                plan: { name: 'старый' },
            },
        })
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
        })
        expect(tx.subscription.create).toHaveBeenCalled()
    })

    it('allows a new abonement once the previous one was cancelled', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            accessUntil: null,
            workspace: { timezone: 'Asia/Tomsk' },
            subscription: {
                status: 'CANCELLED',
                endDate: new Date('2026-12-31T00:00:00Z'),
                classesRemaining: 3,
                classesTotal: 12,
                plan: { name: 'снятый' },
            },
        })
        await svcWith(tx).grantFromPlan({
            workspaceId: 'w1',
            workspaceMemberId: 'm1',
            planId: 'p1',
            startDate: new Date('2026-07-01T00:00:00Z'),
        })
        expect(tx.subscription.create).toHaveBeenCalled()
    })

    describe('first-visit tariffs', () => {
        const NOW = new Date('2026-10-24T10:00:00Z') // Tomsk (UTC+7): 17:00 local
        const firstVisitPlan = { ...plan, startsOnFirstVisit: true }
        const member = (over: Record<string, unknown> = {}) => ({
            id: 'm1',
            userId: 'u1',
            accessUntil: null,
            workspace: { timezone: 'Asia/Tomsk' },
            ...over,
        })

        it('sells a pending abonement with provisional access up to the auto-start + the term', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(firstVisitPlan)
            tx.workspaceMember.findFirst.mockResolvedValue(member())
            const started = { id: 's1', startDate: new Date('2026-10-24T17:00:00Z') }
            tx.subscription.findUniqueOrThrow.mockResolvedValue(started)
            tx.workspaceMember.findUniqueOrThrow.mockResolvedValue({
                accessUntil: new Date('2026-11-23T17:00:00Z'),
            })
            const res = await svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                now: NOW,
            })
            const data = tx.subscription.create.mock.calls[0][0].data
            expect(data.startDate).toBeNull()
            expect(data.endDate).toBeNull()
            expect(data.startsOnFirstVisit).toBe(true)
            expect(data.durationDays).toBe(30)
            // 2026-10-24 00:00 Tomsk = 2026-10-23T17:00Z, + 14 days auto-start + 30 days.
            expect(tx.workspaceMember.update).toHaveBeenCalledWith({
                where: { id: 'm1' },
                data: {
                    subscriptionId: 's1',
                    accessUntil: new Date('2026-12-06T17:00:00Z'),
                },
            })
            expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(tx, {
                workspaceId: 'w1',
                userId: 'u1',
                now: NOW,
            })
            expect(res.subscription).toBe(started)
            expect(res.accessUntil).toEqual(new Date('2026-11-23T17:00:00Z'))
        })

        it('an explicit start date makes a dated abonement even on a first-visit plan', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(firstVisitPlan)
            tx.workspaceMember.findFirst.mockResolvedValue(member())
            await svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                startDate: new Date('2026-10-10T00:00:00Z'),
                now: NOW,
            })
            const data = tx.subscription.create.mock.calls[0][0].data
            expect(data.startDate).toEqual(new Date('2026-10-10T00:00:00Z'))
            expect(data.endDate).toEqual(new Date('2026-11-09T00:00:00Z'))
            expect(data.startsOnFirstVisit).toBe(false)
            expect(syncFirstVisitStartInTx).not.toHaveBeenCalled()
        })

        it('a plain plan without a date starts now', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue({ ...plan, startsOnFirstVisit: false })
            tx.workspaceMember.findFirst.mockResolvedValue(member())
            await svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                now: NOW,
            })
            const data = tx.subscription.create.mock.calls[0][0].data
            expect(data.startDate).toEqual(NOW)
            expect(data.startsOnFirstVisit).toBe(false)
        })

        it('names a pending abonement in the refusal', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(plan)
            tx.workspaceMember.findFirst.mockResolvedValue(
                member({
                    subscription: {
                        id: 'old',
                        status: 'ACTIVE',
                        startDate: null,
                        endDate: null,
                        classesRemaining: null,
                        classesTotal: null,
                        plan: { name: 'Стандарт' },
                    },
                }),
            )
            await expect(
                svcWith(tx).grantFromPlan({
                    workspaceId: 'w1',
                    workspaceMemberId: 'm1',
                    planId: 'p1',
                    now: NOW,
                }),
            ).rejects.toThrow(/«Стандарт», начнётся с первой тренировки/)
        })
    })

    describe('a back-to-back renewal', () => {
        const withCurrent = (endDate: Date) => ({
            id: 'm1',
            userId: 'u1',
            accessUntil: null,
            workspace: { timezone: 'Asia/Tomsk' },
            subscription: {
                id: 'old',
                status: 'ACTIVE',
                startDate: new Date('2026-10-31T00:00:00Z'),
                endDate,
                classesRemaining: null,
                classesTotal: null,
                plan: { name: 'Стандарт' },
            },
        })
        // The club-local midnight of 30 November in Tomsk (UTC+7).
        const newStart = new Date('2026-11-29T17:00:00Z')

        it('is allowed when the old one ends on the new start’s club day', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(plan)
            // Ends 00:00Z on the 30th = 07:00 on the 30th in Tomsk, after newStart as an instant.
            tx.workspaceMember.findFirst.mockResolvedValue(
                withCurrent(new Date('2026-11-30T00:00:00Z')),
            )
            await svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                startDate: newStart,
            })
            expect(tx.subscription.create).toHaveBeenCalled()
        })

        it('still refuses when the old one runs past the new start’s club day', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(plan)
            tx.workspaceMember.findFirst.mockResolvedValue(
                withCurrent(new Date('2026-12-01T00:00:00Z')),
            )
            await expect(
                svcWith(tx).grantFromPlan({
                    workspaceId: 'w1',
                    workspaceMemberId: 'm1',
                    planId: 'p1',
                    startDate: newStart,
                }),
            ).rejects.toThrow(/уже есть действующий абонемент/)
            expect(tx.subscription.create).not.toHaveBeenCalled()
        })
    })

    describe('a used-up class pack', () => {
        const NOW = new Date('2026-10-24T10:00:00Z')
        const usedUp = (over: Record<string, unknown> = {}) => ({
            id: 'm1',
            userId: 'u1',
            accessUntil: null,
            workspace: { timezone: 'Asia/Tomsk' },
            subscription: {
                id: 'old',
                status: 'ACTIVE',
                startDate: new Date('2026-10-01T00:00:00Z'),
                endDate: new Date('2026-10-31T00:00:00Z'),
                classesRemaining: 0,
                classesTotal: 8,
                plan: { name: '8 занятий' },
                ...over,
            },
        })

        it('does not block a sale and is closed as EXPIRED', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(plan)
            tx.workspaceMember.findFirst.mockResolvedValue(usedUp())
            await svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'p1',
                now: NOW,
            })
            expect(tx.subscription.updateMany).toHaveBeenCalledWith({
                where: { id: 'old', status: 'ACTIVE' },
                data: { status: 'EXPIRED' },
            })
            expect(tx.subscription.create).toHaveBeenCalled()
        })

        it('still refuses a pack with classes left', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(plan)
            tx.workspaceMember.findFirst.mockResolvedValue(
                usedUp({ classesRemaining: 2 }),
            )
            await expect(
                svcWith(tx).grantFromPlan({
                    workspaceId: 'w1',
                    workspaceMemberId: 'm1',
                    planId: 'p1',
                    now: NOW,
                }),
            ).rejects.toThrow(/осталось 2 из 8/)
            expect(tx.subscription.updateMany).not.toHaveBeenCalled()
        })

        it('refuses when the used-up pack changed under us (compare-and-set)', async () => {
            const tx = makeTx()
            tx.plan.findFirst.mockResolvedValue(plan)
            tx.workspaceMember.findFirst.mockResolvedValue(usedUp())
            tx.subscription.updateMany.mockResolvedValue({ count: 0 })
            await expect(
                svcWith(tx).grantFromPlan({
                    workspaceId: 'w1',
                    workspaceMemberId: 'm1',
                    planId: 'p1',
                    now: NOW,
                }),
            ).rejects.toThrow(BadRequestError)
            expect(tx.subscription.create).not.toHaveBeenCalled()
        })
    })

    it('404s an unknown plan', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(null)
        await expect(
            svcWith(tx).grantFromPlan({
                workspaceId: 'w1',
                workspaceMemberId: 'm1',
                planId: 'nope',
                startDate: new Date(),
            }),
        ).rejects.toThrow(/Тариф не найден/i)
    })
})

const cancelSub = () => ({
    id: 's1',
    endDate: new Date('2026-11-30T00:00:00Z'),
    workspace: { timezone: 'Europe/Moscow' },
    workspaceMember: { id: 'm1', accessUntil: new Date('2026-11-30T00:00:00Z') },
})

describe('cancel', () => {
    it('marks cancelled and clears the current pointer', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(cancelSub())
        tx.subscription.findUniqueOrThrow.mockResolvedValue({ id: 's1', status: 'CANCELLED' })
        await svcWith(tx).cancel({ workspaceId: 'w1', subscriptionId: 's1' })
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
        })
        expect(tx.workspaceMember.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', subscriptionId: 's1' },
            data: { subscriptionId: null },
        })
    })

    it('refuses when the abonement changed under us (compare-and-set)', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(cancelSub())
        tx.subscription.updateMany.mockResolvedValue({ count: 0 })
        await expect(
            svcWith(tx).cancel({ workspaceId: 'w1', subscriptionId: 's1' }),
        ).rejects.toThrow(BadRequestError)
        expect(tx.subscription.findUniqueOrThrow).not.toHaveBeenCalled()
        expect(tx.workspaceMember.updateMany).not.toHaveBeenCalled()
    })

    it('releases an open freeze and gives its days back before cancelling', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-24T10:00:00Z'))
        try {
            const tx = makeTx()
            tx.subscription.findFirst.mockResolvedValue(cancelSub())
            tx.subscription.findUniqueOrThrow.mockResolvedValue({ id: 's1', status: 'CANCELLED' })
            tx.subscriptionFreeze.findMany.mockResolvedValue([
                {
                    id: 'f1',
                    fromDate: new Date('2026-11-01T00:00:00Z'),
                    untilDate: new Date('2026-11-07T00:00:00Z'),
                    accessShifted: true,
                },
            ])
            await svcWith(tx).cancel({ workspaceId: 'w1', subscriptionId: 's1' })
            const back = new Date('2026-11-30T00:00:00Z').getTime() - 7 * 86_400_000
            expect(tx.subscription.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 's1',
                    status: 'ACTIVE',
                    endDate: new Date('2026-11-30T00:00:00Z'),
                },
                data: { endDate: new Date(back) },
            })
            expect(tx.workspaceMember.update).toHaveBeenCalledWith({
                where: { id: 'm1' },
                data: { accessUntil: new Date(back) },
            })
            expect(tx.subscriptionFreeze.delete).toHaveBeenCalledWith({
                where: { id: 'f1' },
            })
        } finally {
            jest.useRealTimers()
        }
    })
})

describe('markPaid', () => {
    const now = new Date('2026-10-24T05:00:00Z')
    const unpaid = (over: Record<string, unknown> = {}) => ({
        id: 's1',
        status: 'ACTIVE',
        isPaid: false,
        paidAt: null,
        amountPaid: 5000,
        workspace: { timezone: 'Asia/Tomsk' },
        ...over,
    })
    const params = { workspaceId: 'w1', userId: 'u1', subscriptionId: 's1', now }

    it('looks the abonement up by workspace and member user', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(unpaid())
        tx.subscription.findUniqueOrThrow.mockResolvedValue({ id: 's1', isPaid: true })
        await svcWith(tx).markPaid(params)
        expect(tx.subscription.findFirst.mock.calls[0][0].where).toEqual({
            id: 's1',
            workspaceId: 'w1',
            workspaceMember: { userId: 'u1' },
        })
    })

    it('keeps the agreed price by default', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(unpaid())
        tx.subscription.findUniqueOrThrow.mockResolvedValue({ id: 's1', isPaid: true })
        const res = await svcWith(tx).markPaid(params)
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', isPaid: false, status: { not: 'CANCELLED' } },
            data: { isPaid: true, paidAt: now, amountPaid: 5000 },
        })
        expect(res).toEqual({ id: 's1', isPaid: true })
    })

    it('records the amount actually received, even 0', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(unpaid())
        tx.subscription.findUniqueOrThrow.mockResolvedValue({ id: 's1' })
        await svcWith(tx).markPaid({ ...params, amount: 0 })
        expect(tx.subscription.updateMany.mock.calls[0][0].data.amountPaid).toBe(0)
    })

    it('can still be paid after it expired', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(unpaid({ status: 'EXPIRED' }))
        tx.subscription.findUniqueOrThrow.mockResolvedValue({ id: 's1' })
        await svcWith(tx).markPaid(params)
        expect(tx.subscription.updateMany).toHaveBeenCalled()
    })

    it('says not found for an abonement of another member', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(null)
        await expect(svcWith(tx).markPaid(params)).rejects.toThrow(
            /Абонемент не найден/,
        )
    })

    it('refuses a cancelled abonement', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(unpaid({ status: 'CANCELLED' }))
        await expect(svcWith(tx).markPaid(params)).rejects.toThrow(
            /отменён — отметить оплату нельзя/,
        )
        expect(tx.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('refuses an already paid abonement and says when', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(
            unpaid({ isPaid: true, paidAt: new Date('2026-10-22T05:00:00Z') }),
        )
        await expect(svcWith(tx).markPaid(params)).rejects.toThrow(
            /Оплата уже отмечена 22 октября/,
        )
    })

    it('refuses when the abonement changed under us (compare-and-set)', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(unpaid())
        tx.subscription.updateMany.mockResolvedValue({ count: 0 })
        await expect(svcWith(tx).markPaid(params)).rejects.toThrow(BadRequestError)
        expect(tx.subscription.findUniqueOrThrow).not.toHaveBeenCalled()
    })
})
