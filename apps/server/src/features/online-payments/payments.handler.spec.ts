jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        rootUrl: 'https://api.example.com/',
        appUrl: 'https://app.example.com',
    },
}))

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { RefundPaymentFeature } from './refund-payment.feature'
import { RefundPaymentHandler } from './refund-payment.handler'

const KEY = 'unit-test-encryption-key'

const OWNER_ID = 'owner-1'

// Resolves the scope the way RbacService does: a head coach (like an admin)
// runs every group; only the caller's identity decides who is a club admin.
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
// The owner passes whatever their member row says.
const OWNER: Caller = { userId: OWNER_ID, roleName: 'head_coach' }
const HEAD_COACH: Caller = { userId: 'hc-1', roleName: 'head_coach' }

const row = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    planId: 'plan-1',
    planName: 'Безлимит',
    eventRegistrationId: null,
    subscriptionId: 'sub-1',
    provider: 'YOOKASSA',
    providerPaymentId: 'yk-1',
    confirmationUrl: 'https://pay',
    amount: 4500,
    currency: 'RUB',
    status: 'SUCCEEDED',
    idempotenceKey: 'idem',
    activationError: null,
    createdAt: new Date('2026-11-01T09:00:00Z'),
    updatedAt: new Date('2026-11-01T09:00:00Z'),
    paidAt: new Date('2026-11-01T09:01:00Z'),
    refundedAt: null,
    user: { firstname: 'Иван', lastname: 'Петров', email: 'ivan@example.com' },
    ...over,
})

describe('refundPayment', () => {
    const settings = {
        workspaceId: 'ws-1',
        provider: 'YOOKASSA',
        shopId: '123',
        secretKeyEncrypted: encryptPaymentSecret('live_key_1234', KEY),
        webhookSecretEncrypted: null,
        receiptEnabled: true,
        vatCode: 1,
        paymentSubject: 'service',
        paymentMode: 'full_prepayment',
    }
    const setup = (opts: {
        payment?: Record<string, unknown> | null
        settings?: Record<string, unknown> | null
        refundError?: Error
        casCount?: number
        caller?: Caller
    } = {}) => {
        const prisma: Record<string, unknown> & {
            payment: Record<string, jest.Mock>
            eventRegistration: Record<string, jest.Mock>
        } = {
            payment: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue(opts.payment === undefined ? row() : opts.payment),
                updateMany: jest.fn().mockResolvedValue({ count: opts.casCount ?? 1 }),
                findUniqueOrThrow: jest.fn().mockResolvedValue(
                    row({ status: 'REFUNDED', refundedAt: new Date('2026-11-02T00:00:00Z') }),
                ),
            },
            eventRegistration: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            workspacePaymentSettings: {
                findUnique: jest
                    .fn()
                    .mockResolvedValue(opts.settings === undefined ? settings : opts.settings),
            },
        }
        prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma))
        const gateway = {
            refund: opts.refundError
                ? jest.fn().mockRejectedValue(opts.refundError)
                : jest.fn().mockResolvedValue(undefined),
        }
        const audit = { record: jest.fn() }
        const realtime = { invalidate: jest.fn() }
        const caller = opts.caller ?? ADMIN
        const run = () =>
            new RefundPaymentHandler(
                prisma as never,
                rbac() as never,
                gateway as never,
                audit as never,
                realtime as never,
            ).execute(
                new RefundPaymentFeature('ws-1', 'pay-1', caller.userId, caller.roleName, false),
            )
        return { prisma, gateway, audit, run }
    }

    it('refuses a head coach, even one who runs every group', async () => {
        const s = setup({ caller: HEAD_COACH })
        await expect(s.run()).rejects.toMatchObject({ statusCode: 403 })
        expect(s.gateway.refund).not.toHaveBeenCalled()
        expect(s.prisma.payment.updateMany).not.toHaveBeenCalled()
    })

    it.each([
        ['an admin', ADMIN],
        ['the owner', OWNER],
    ])('lets %s refund', async (_, caller) => {
        const s = setup({ caller })
        await expect(s.run()).resolves.toMatchObject({ status: 'REFUNDED' })
        expect(s.gateway.refund).toHaveBeenCalledTimes(1)
    })

    it('404s on a payment of another club', async () => {
        const s = setup({ payment: null })
        await expect(s.run()).rejects.toMatchObject({ statusCode: 404 })
        expect(s.prisma.payment.findFirst.mock.calls[0][0].where).toEqual({
            id: 'pay-1',
            workspaceId: 'ws-1',
        })
    })

    it('refuses a payment that is not SUCCEEDED', async () => {
        for (const status of ['PENDING', 'CANCELED', 'REFUNDED']) {
            const s = setup({ payment: row({ status }) })
            await expect(s.run()).rejects.toMatchObject({ statusCode: 400 })
            expect(s.gateway.refund).not.toHaveBeenCalled()
        }
    })

    it('refuses when the provider of the payment is no longer connected', async () => {
        for (const st of [null, { ...settings, provider: 'STRIPE' }]) {
            const s = setup({ settings: st })
            await expect(s.run()).rejects.toMatchObject({ statusCode: 400 })
        }
    })

    it('refunds at the provider with a stable key, marks REFUNDED, keeps the abonement', async () => {
        const s = setup()
        const out = await s.run()
        expect(s.gateway.refund.mock.calls[0][1]).toEqual({
            paymentId: 'pay-1',
            providerPaymentId: 'yk-1',
            amount: 4500,
            currency: 'RUB',
            idempotenceKey: 'refund-pay-1',
        })
        expect(s.prisma.payment.updateMany.mock.calls[0][0]).toMatchObject({
            where: { id: 'pay-1', status: 'SUCCEEDED' },
            data: { status: 'REFUNDED' },
        })
        expect(out).toMatchObject({ status: 'REFUNDED', subscriptionId: 'sub-1' })
        expect(s.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'payment.refund',
            actorId: 'a-1',
            targetId: 'u-1',
        })
        expect(s.prisma.eventRegistration.updateMany).not.toHaveBeenCalled()
    })

    it('a ticket payment takes its «paid ONLINE» mark back with the refund', async () => {
        const s = setup({
            payment: row({ planId: null, subscriptionId: null, eventRegistrationId: 'reg-1' }),
        })
        await s.run()
        expect(s.prisma.eventRegistration.updateMany.mock.calls[0][0]).toMatchObject({
            where: { id: 'reg-1', isPaid: true, paymentMethod: 'ONLINE' },
            data: { isPaid: false, paidAt: null, amountPaid: null, paymentMethod: null },
        })
    })

    it('a ticket payment that never marked the ticket (activationError) leaves it', async () => {
        const s = setup({
            payment: row({
                planId: null,
                subscriptionId: null,
                eventRegistrationId: 'reg-1',
                activationError: 'Билет уже отмечен оплаченным',
            }),
        })
        await s.run()
        expect(s.prisma.eventRegistration.updateMany).not.toHaveBeenCalled()
    })

    it('surfaces the provider refusal and leaves the payment as is', async () => {
        const s = setup({
            refundError: new PaymentGatewayError('x', 400, 'Refund amount exceeds'),
        })
        await expect(s.run()).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('Refund amount exceeds'),
        })
        expect(s.prisma.payment.updateMany).not.toHaveBeenCalled()
    })

    it('a concurrent second refund is refused by the compare-and-set', async () => {
        const s = setup({ casCount: 0 })
        await expect(s.run()).rejects.toMatchObject({ statusCode: 400 })
        expect(s.audit.record).not.toHaveBeenCalled()
    })
})
