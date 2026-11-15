import {
    REFUND_CONFLICT,
    REFUND_ONLINE_FINAL,
    RefundService,
} from '../../domains/payments/services/refund.service'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { DeleteRefundFeature } from './delete-refund.feature'
import { DeleteRefundHandler } from './delete-refund.handler'

const OWNER_ID = 'owner-1'
const REFUND_ID = '3a7b1c4d-5e6f-4a81-9c23-d4e5f6a7b8c9'

const rbac = () => ({
    resolveCoachScope: jest.fn(
        async (p: { userId: string; workspaceId: string; roleName: string | null }) => ({
            scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
            userId: p.userId,
            workspaceId: p.workspaceId,
            workspaceOwnerId: OWNER_ID,
        }),
    ),
    canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
})

type Caller = { userId: string; roleName: string }
const ADMIN: Caller = { userId: 'a-1', roleName: 'admin' }
const OWNER: Caller = { userId: OWNER_ID, roleName: 'user' }

const refundRow = (over: Record<string, unknown> = {}) => ({
    id: REFUND_ID,
    workspaceId: 'w1',
    subscriptionId: 'sub-1',
    eventRegistrationId: null,
    paymentId: null,
    userId: 'u-1',
    itemName: 'Безлимит',
    amount: 1000,
    currency: 'RUB',
    method: 'CASH',
    reason: 'Ошибся',
    createdById: 'a-1',
    refundedAt: new Date('2026-11-10T10:00:00Z'),
    createdAt: new Date('2026-11-10T10:00:00Z'),
    ...over,
})

const setup = (opts: { refund?: Record<string, unknown> | null; restored?: number } = {}) => {
    const prisma: Record<string, unknown> & Record<string, Record<string, jest.Mock>> = {
        refund: {
            findFirst: jest.fn().mockResolvedValue(opts.refund === undefined ? refundRow() : opts.refund),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        subscription: { updateMany: jest.fn().mockResolvedValue({ count: opts.restored ?? 1 }) },
        eventRegistration: { updateMany: jest.fn().mockResolvedValue({ count: opts.restored ?? 1 }) },
    }
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)) as never
    const audit = { record: jest.fn() }
    const realtime = { invalidate: jest.fn() }
    const service = new RefundService(
        prisma as never,
        {} as never,
        {} as never,
        audit as never,
        {} as never,
        realtime as never,
    )
    const run = (caller: Caller = ADMIN) =>
        new DeleteRefundHandler(rbac() as never, service).execute(
            new DeleteRefundFeature(REFUND_ID, 'w1', caller.userId, caller.roleName, false),
        )
    return { prisma, audit, realtime, run }
}

describe('deleteRefund', () => {
    it.each([
        ['a head coach', { userId: 'hc-1', roleName: 'head_coach' }],
        ['a coach', { userId: 'c-1', roleName: 'coach' }],
    ])('refuses %s before reading anything', async (_, caller) => {
        const { prisma, run } = setup()
        await expect(run(caller)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.refund.findFirst).not.toHaveBeenCalled()
    })

    it('404s on a refund of another club', async () => {
        const { run } = setup({ refund: null })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
    })

    it('an online refund is final', async () => {
        const { prisma, run } = setup({ refund: refundRow({ method: 'ONLINE', paymentId: 'p-1' }) })
        await expect(run()).rejects.toThrow(REFUND_ONLINE_FINAL)
        expect(prisma.refund.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes an offline record and gives the abonement its amount back, audited', async () => {
        const { prisma, audit, realtime, run } = setup()
        await expect(run(OWNER)).resolves.toEqual({ status: 'deleted' })
        expect(prisma.refund.deleteMany).toHaveBeenCalledWith({ where: { id: REFUND_ID } })
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 'sub-1', refundedAmount: { gte: 1000 } },
            data: { refundedAmount: { decrement: 1000 } },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'payment.refundDelete',
                targetId: 'u-1',
                actorId: OWNER_ID,
                metadata: expect.objectContaining({
                    refundId: REFUND_ID,
                    target: 'abonement',
                    targetId: 'sub-1',
                    amount: 1000,
                    method: 'CASH',
                    reason: 'Ошибся',
                }),
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['payments', 'members', 'subscription'])
    })

    it('a ticket’s record decrements the registration', async () => {
        const { prisma, realtime, run } = setup({
            refund: refundRow({ subscriptionId: null, eventRegistrationId: 'reg-1' }),
        })
        await run()
        expect(prisma.eventRegistration.updateMany).toHaveBeenCalledWith({
            where: { id: 'reg-1', refundedAmount: { gte: 1000 } },
            data: { refundedAmount: { decrement: 1000 } },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['payments', 'events', 'eventregistrations'])
    })

    it('a sale whose sum no longer covers the record is a 409 (rolled back)', async () => {
        const { audit, run } = setup({ restored: 0 })
        await expect(run()).rejects.toThrow(REFUND_CONFLICT)
        expect(audit.record).not.toHaveBeenCalled()
    })
})
