import { BadRequestError } from '../../../shared/errors/shared.errors'
import { PaymentActivationService } from './payment-activation.service'

const now = new Date('2026-11-01T09:00:00Z')

const paymentRow = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    planId: 'plan-1',
    planName: 'Безлимит',
    provider: 'YOOKASSA',
    providerPaymentId: 'yk-1',
    amount: 4500,
    currency: 'RUB',
    status: 'PENDING',
    ...over,
})

const gateway = (over: Record<string, unknown> = {}) => ({
    providerPaymentId: 'yk-1',
    status: 'SUCCEEDED' as const,
    confirmationUrl: null,
    amountMinor: 450000,
    currency: 'RUB',
    ...over,
})

const setup = (opts: {
    payment?: Record<string, unknown> | null
    claimCount?: number
    member?: Record<string, unknown> | null
    grantError?: Error
    markCount?: number
} = {}) => {
    const tx = {
        payment: {
            updateMany: jest
                .fn()
                .mockResolvedValue({ count: opts.claimCount ?? 1 }),
            update: jest.fn().mockResolvedValue({}),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                opts.member === undefined
                    ? {
                          id: 'm-1',
                          workspace: { timezone: 'Europe/Moscow' },
                          subscription: null,
                      }
                    : opts.member,
            ),
        },
    }
    const prisma = {
        payment: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    opts.payment === undefined ? paymentRow() : opts.payment,
                ),
            updateMany: jest
                .fn()
                .mockResolvedValue({ count: opts.markCount ?? 1 }),
        },
        $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    }
    const subscriptions = {
        grantFromPlanInTx: opts.grantError
            ? jest.fn().mockRejectedValue(opts.grantError)
            : jest.fn().mockResolvedValue({
                  subscription: { id: 'sub-1', plan: { name: 'Безлимит' } },
                  accessUntil: new Date('2026-12-01T00:00:00Z'),
              }),
    }
    const audit = { record: jest.fn() }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const service = new PaymentActivationService(
        prisma as never,
        subscriptions as never,
        audit as never,
        notifications as never,
        realtime as never,
    )
    return { service, prisma, tx, subscriptions, audit, notifications, realtime }
}

describe('PaymentActivationService.applyProviderStatus', () => {
    it('claims the payment and grants the abonement like the coach sale, as GATEWAY', async () => {
        const s = setup()
        const out = await s.service.applyProviderStatus({
            workspaceId: 'ws-1',
            gateway: gateway(),
            now,
        })
        expect(out).toBe('activated')
        expect(s.tx.payment.updateMany).toHaveBeenCalledWith({
            where: { id: 'pay-1', status: 'PENDING' },
            data: { status: 'SUCCEEDED', paidAt: now },
        })
        expect(s.subscriptions.grantFromPlanInTx).toHaveBeenCalledWith(s.tx, {
            workspaceId: 'ws-1',
            workspaceMemberId: 'm-1',
            planId: 'plan-1',
            startDate: undefined,
            now,
            amountPaid: 4500,
            paid: true,
            source: 'GATEWAY',
            provider: 'yookassa',
            externalPaymentId: 'yk-1',
        })
        expect(s.tx.payment.update).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { subscriptionId: 'sub-1' },
        })
        expect(s.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'payment.succeeded',
            targetId: 'u-1',
            actorId: 'u-1',
            metadata: { subscriptionId: 'sub-1', amount: 4500 },
        })
        expect(s.notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'u-1',
            kind: 'payment.succeeded',
            refId: 'pay-1',
            topic: 'Оплата прошла',
        })
    })

    it('renews from the end of a live abonement', async () => {
        const s = setup({
            member: {
                id: 'm-1',
                workspace: { timezone: 'Europe/Moscow' },
                subscription: {
                    status: 'ACTIVE',
                    startDate: new Date('2026-10-15T21:00:00Z'),
                    endDate: new Date('2026-11-14T21:00:00Z'),
                    classesTotal: null,
                    classesRemaining: null,
                },
            },
        })
        await s.service.applyProviderStatus({
            workspaceId: 'ws-1',
            gateway: gateway(),
            now,
        })
        expect(
            s.subscriptions.grantFromPlanInTx.mock.calls[0][1].startDate,
        ).toEqual(new Date('2026-11-14T21:00:00Z'))
    })

    it('does nothing on a duplicate delivery: the claim finds no PENDING row', async () => {
        const s = setup({ claimCount: 0 })
        const out = await s.service.applyProviderStatus({
            workspaceId: 'ws-1',
            gateway: gateway(),
            now,
        })
        expect(out).toBe('unchanged')
        expect(s.subscriptions.grantFromPlanInTx).not.toHaveBeenCalled()
        expect(s.audit.record).not.toHaveBeenCalled()
        expect(s.notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('records a paid-but-not-granted payment for staff when the grant is refused', async () => {
        const s = setup({
            grantError: new BadRequestError({ message: 'У участника уже есть действующий абонемент' }),
        })
        const out = await s.service.applyProviderStatus({
            workspaceId: 'ws-1',
            gateway: gateway(),
            now,
        })
        expect(out).toBe('paid-not-activated')
        expect(s.prisma.payment.updateMany).toHaveBeenCalledWith({
            where: { id: 'pay-1', status: 'PENDING' },
            data: {
                status: 'SUCCEEDED',
                paidAt: now,
                activationError: 'У участника уже есть действующий абонемент',
            },
        })
        expect(s.notifications.notifyUser.mock.calls[0][0].topic).toBe(
            'Оплата получена',
        )
    })

    it('records the member who left the club, a blocked renewal and a deleted plan', async () => {
        for (const opts of [
            { member: null },
            {
                member: {
                    id: 'm-1',
                    workspace: { timezone: 'UTC' },
                    subscription: {
                        status: 'ACTIVE',
                        startDate: now,
                        endDate: new Date('2026-12-01T00:00:00Z'),
                        classesTotal: 10,
                        classesRemaining: 4,
                    },
                },
            },
            { payment: paymentRow({ planId: null }) },
        ]) {
            const s = setup(opts)
            expect(
                await s.service.applyProviderStatus({
                    workspaceId: 'ws-1',
                    gateway: gateway(),
                    now,
                }),
            ).toBe('paid-not-activated')
            expect(s.subscriptions.grantFromPlanInTx).not.toHaveBeenCalled()
        }
    })

    it('a concurrent duplicate of a refused grant is recorded once', async () => {
        const s = setup({
            grantError: new BadRequestError({ message: 'x' }),
            markCount: 0,
        })
        expect(
            await s.service.applyProviderStatus({
                workspaceId: 'ws-1',
                gateway: gateway(),
                now,
            }),
        ).toBe('unchanged')
        expect(s.notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('rethrows unexpected errors so the provider retries', async () => {
        const s = setup({ grantError: new Error('db down') })
        await expect(
            s.service.applyProviderStatus({
                workspaceId: 'ws-1',
                gateway: gateway(),
                now,
            }),
        ).rejects.toThrow('db down')
    })

    it('never activates when the amount or currency differs from what was asked', async () => {
        for (const g of [gateway({ amountMinor: 100 }), gateway({ currency: 'USD' })]) {
            const s = setup()
            expect(
                await s.service.applyProviderStatus({
                    workspaceId: 'ws-1',
                    gateway: g,
                    now,
                }),
            ).toBe('unchanged')
            expect(s.prisma.$transaction).not.toHaveBeenCalled()
        }
    })

    it('cancels a pending payment once', async () => {
        const s = setup()
        expect(
            await s.service.applyProviderStatus({
                workspaceId: 'ws-1',
                gateway: gateway({ status: 'CANCELED' }),
            }),
        ).toBe('canceled')
        expect(s.prisma.payment.updateMany).toHaveBeenCalledWith({
            where: { id: 'pay-1', status: 'PENDING' },
            data: { status: 'CANCELED' },
        })
        const again = setup({ markCount: 0 })
        expect(
            await again.service.applyProviderStatus({
                workspaceId: 'ws-1',
                gateway: gateway({ status: 'CANCELED' }),
            }),
        ).toBe('unchanged')
    })

    it('ignores unknown payments and still-pending ones', async () => {
        const unknown = setup({ payment: null })
        expect(
            await unknown.service.applyProviderStatus({
                workspaceId: 'ws-1',
                gateway: gateway(),
            }),
        ).toBe('unchanged')
        const pending = setup()
        expect(
            await pending.service.applyProviderStatus({
                workspaceId: 'ws-1',
                gateway: gateway({ status: 'PENDING' }),
            }),
        ).toBe('unchanged')
        expect(pending.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('a failed push never fails the webhook', async () => {
        const s = setup()
        s.notifications.notifyUser.mockRejectedValue(new Error('push down'))
        expect(
            await s.service.applyProviderStatus({
                workspaceId: 'ws-1',
                gateway: gateway(),
                now,
            }),
        ).toBe('activated')
    })
})
