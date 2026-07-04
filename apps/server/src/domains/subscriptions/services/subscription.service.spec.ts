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
