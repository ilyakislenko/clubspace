import { SubscriptionService } from './subscription.service'

const makeTx = () => ({
    plan: { findFirst: jest.fn() },
    workspaceMember: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    subscription: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: 's1', ...data })),
        findFirst: jest.fn(),
        update: jest.fn(),
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
        ).rejects.toThrow(/free trial already used/i)
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
        ).rejects.toThrow(/already has an active abonement/)
        expect(tx.subscription.create).not.toHaveBeenCalled()
    })

    it('names the remaining balance so the admin knows what they would destroy', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            accessUntil: null,
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
        ).rejects.toThrow(/лимит 12: 7\/12 classes left/)
    })

    it('allows a new abonement once the previous one has expired', async () => {
        const tx = makeTx()
        tx.plan.findFirst.mockResolvedValue(plan)
        tx.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            accessUntil: null,
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
        ).rejects.toThrow(/plan not found/i)
    })
})

describe('cancel', () => {
    it('marks cancelled and clears the current pointer', async () => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue({ id: 's1' })
        tx.subscription.update.mockResolvedValue({ id: 's1', status: 'CANCELLED' })
        await svcWith(tx).cancel({ workspaceId: 'w1', subscriptionId: 's1' })
        expect(tx.subscription.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 's1' },
                data: { status: 'CANCELLED' },
            }),
        )
        expect(tx.workspaceMember.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', subscriptionId: 's1' },
            data: { subscriptionId: null },
        })
    })
})
