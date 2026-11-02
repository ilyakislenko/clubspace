jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        rootUrl: 'https://api.example.com/',
        appUrl: 'https://app.example.com',
    },
}))

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { ListPaymentsFeature } from './list-payments.feature'
import { ListPaymentsHandler } from './list-payments.handler'
import { RefundPaymentFeature } from './refund-payment.feature'
import { RefundPaymentHandler } from './refund-payment.handler'

const KEY = 'unit-test-encryption-key'

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

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

describe('listPayments', () => {
    it('refuses a coach', async () => {
        const prisma = { payment: { findMany: jest.fn(), count: jest.fn() } }
        await expect(
            new ListPaymentsHandler(prisma as never, rbac(false) as never).execute(
                new ListPaymentsFeature({}, 'ws-1', 'c-1', 'coach', false),
            ),
        ).rejects.toMatchObject({ statusCode: 403 })
        expect(prisma.payment.findMany).not.toHaveBeenCalled()
    })

    it('lists this club only, newest first, filtered and paged', async () => {
        const prisma = {
            payment: {
                findMany: jest.fn().mockResolvedValue([row()]),
                count: jest.fn().mockResolvedValue(51),
            },
        }
        const out = await new ListPaymentsHandler(
            prisma as never,
            rbac() as never,
        ).execute(
            new ListPaymentsFeature(
                { status: 'SUCCEEDED', page: 2, perPage: 25 },
                'ws-1',
                'a-1',
                'admin',
                false,
            ),
        )
        const args = prisma.payment.findMany.mock.calls[0][0]
        expect(args.where).toEqual({ workspaceId: 'ws-1', status: 'SUCCEEDED' })
        expect(args.orderBy).toEqual({ createdAt: 'desc' })
        expect(args.skip).toBe(25)
        expect(args.take).toBe(25)
        expect(out).toMatchObject({ total: 51, page: 2, perPage: 25 })
        expect(out.data[0]).toMatchObject({
            id: 'pay-1',
            status: 'SUCCEEDED',
            member: { userId: 'u-1', name: 'Иван Петров', email: 'ivan@example.com' },
        })
    })
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
        admin?: boolean
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
        const run = () =>
            new RefundPaymentHandler(
                prisma as never,
                rbac(opts.admin ?? true) as never,
                gateway as never,
                audit as never,
                realtime as never,
            ).execute(new RefundPaymentFeature('ws-1', 'pay-1', 'a-1', 'admin', false))
        return { prisma, gateway, audit, run }
    }

    it('refuses a coach', async () => {
        const s = setup({ admin: false })
        await expect(s.run()).rejects.toMatchObject({ statusCode: 403 })
        expect(s.gateway.refund).not.toHaveBeenCalled()
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
