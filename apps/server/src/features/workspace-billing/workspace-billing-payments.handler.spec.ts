jest.mock('../../environments/environment', () => ({
    environment: { billing: { enabled: true, graceDays: 7 } },
}))

import { ForbiddenError } from '../../shared/errors/shared.errors'
import { GetWorkspaceBillingPaymentHandler } from './get-workspace-billing-payment.handler'
import { ListWorkspaceBillingPaymentsHandler } from './list-workspace-billing-payments.handler'
import { RemoveWorkspaceBillingCardHandler } from './remove-workspace-billing-card.handler'
import { SetWorkspaceBillingModuleHandler } from './set-workspace-billing-module.handler'
import { SetWorkspaceBillingPeriodHandler } from './set-workspace-billing-period.handler'
import { StartWorkspaceBillingCheckoutHandler } from './start-workspace-billing-checkout.handler'
import {
    GetWorkspaceBillingPaymentFeature,
    ListWorkspaceBillingPaymentsFeature,
    RemoveWorkspaceBillingCardFeature,
    SetWorkspaceBillingModuleFeature,
    SetWorkspaceBillingPeriodFeature,
    StartWorkspaceBillingCheckoutFeature,
} from './workspace-billing-payments.feature'

const PAYMENT = {
    id: 'p1',
    workspaceId: 'w1',
    kind: 'PERIOD',
    initiator: 'CLUB',
    module: null,
    periodMonths: 1,
    periodStart: new Date('2026-11-01T00:00:00.000Z'),
    periodEnd: new Date('2026-12-01T00:00:00.000Z'),
    amount: 2990,
    currency: 'RUB',
    lines: {
        lines: [{ code: 'tier', title: 'Тариф «Старт»', amount: 2990 }],
        discounts: [],
        subtotal: 2990,
        discount: 0,
        total: 2990,
        tierCode: 'start',
    },
    tierCode: 'start',
    status: 'SUCCEEDED',
    refundedAmount: 0,
    provider: 'YOOKASSA',
    providerPaymentId: 'yk-1',
    confirmationUrl: null,
    idempotenceKey: 'idem-1',
    cardLast4: '4242',
    cardTitle: 'Visa',
    receiptEmail: 'owner@club.ru',
    failureReason: null,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    paidAt: new Date('2026-11-01T10:01:00.000Z'),
    refundedAt: null,
}

const PAYMENT_DTO = {
    id: 'p1',
    kind: 'PERIOD',
    initiator: 'CLUB',
    module: null,
    status: 'SUCCEEDED',
    amount: 2990,
    refundedAmount: 0,
    currency: 'RUB',
    periodMonths: 1,
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEnd: '2026-12-01T00:00:00.000Z',
    lines: [{ code: 'tier', title: 'Тариф «Старт»', amount: 2990 }],
    discounts: [],
    cardLast4: '4242',
    cardTitle: 'Visa',
    receiptEmail: 'owner@club.ru',
    failureReason: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    paidAt: '2026-11-01T10:01:00.000Z',
    refundedAt: null,
}

const CTX = ['w1', 'u1', 'coach', false] as const

const build = (o: { denied?: boolean } = {}) => {
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!o.denied),
    }
    const payments = {
        startCheckout: jest
            .fn()
            .mockResolvedValue({ payment: PAYMENT, confirmationUrl: 'https://yk/pay' }),
        setModule: jest.fn().mockResolvedValue({
            outcome: 'PAYMENT_REQUIRED',
            payment: PAYMENT,
            confirmationUrl: 'https://yk/pay',
        }),
        list: jest.fn().mockResolvedValue([PAYMENT]),
        refresh: jest.fn().mockResolvedValue(PAYMENT),
        removePaymentMethod: jest.fn().mockResolvedValue(undefined),
        setBillingPeriod: jest.fn().mockResolvedValue({ billingPeriodMonths: 12 }),
    }
    const billing = {
        getState: jest.fn().mockResolvedValue({
            row: {
                autopayEnabled: true,
                paymentMethodId: null,
                autopayFailedAttempts: 0,
                autopayNextAttemptAt: null,
                autopayLastError: null,
            },
            autopayAvailable: true,
        }),
    }
    const legal = {
        assertPaidActionsAllowed: jest.fn().mockResolvedValue(undefined),
        acceptByFirstPayment: jest.fn().mockResolvedValue(null),
    }
    return { rbac, payments, billing, legal }
}

describe('workspace billing payment handlers', () => {
    describe('refuse a non-admin without touching the service', () => {
        const cases: Array<[string, (d: ReturnType<typeof build>) => Promise<unknown>, string]> = [
            [
                'checkout',
                (d) =>
                    new StartWorkspaceBillingCheckoutHandler(d.rbac as never, d.payments as never, d.legal as never).execute(
                        new StartWorkspaceBillingCheckoutFeature({ periodMonths: 1 }, ...CTX),
                    ),
                'startCheckout',
            ],
            [
                'module',
                (d) =>
                    new SetWorkspaceBillingModuleHandler(d.rbac as never, d.payments as never, d.legal as never).execute(
                        new SetWorkspaceBillingModuleFeature({ module: 'VIDEO', enabled: true } as never, ...CTX),
                    ),
                'setModule',
            ],
            [
                'list',
                (d) =>
                    new ListWorkspaceBillingPaymentsHandler(d.rbac as never, d.payments as never).execute(
                        new ListWorkspaceBillingPaymentsFeature(...CTX),
                    ),
                'list',
            ],
            [
                'get',
                (d) =>
                    new GetWorkspaceBillingPaymentHandler(d.rbac as never, d.payments as never).execute(
                        new GetWorkspaceBillingPaymentFeature('p1', ...CTX),
                    ),
                'refresh',
            ],
            [
                'remove card',
                (d) =>
                    new RemoveWorkspaceBillingCardHandler(
                        d.rbac as never,
                        d.payments as never,
                        d.billing as never,
                    ).execute(new RemoveWorkspaceBillingCardFeature(...CTX)),
                'removePaymentMethod',
            ],
            [
                'period',
                (d) =>
                    new SetWorkspaceBillingPeriodHandler(d.rbac as never, d.payments as never).execute(
                        new SetWorkspaceBillingPeriodFeature({ periodMonths: 12 }, ...CTX),
                    ),
                'setBillingPeriod',
            ],
        ]
        it.each(cases)('%s', async (_name, run, method) => {
            const d = build({ denied: true })
            await expect(run(d)).rejects.toBeInstanceOf(ForbiddenError)
            expect(d.payments[method as keyof typeof d.payments]).not.toHaveBeenCalled()
        })
    })

    it('starts a checkout for the chosen period and returns the payment page', async () => {
        const d = build()
        const out = await new StartWorkspaceBillingCheckoutHandler(d.rbac as never, d.payments as never, d.legal as never).execute(
            new StartWorkspaceBillingCheckoutFeature({ periodMonths: 12 }, ...CTX, '10.0.0.1', 'Safari'),
        )
        expect(d.legal.assertPaidActionsAllowed).toHaveBeenCalledWith('w1')
        expect(d.payments.startCheckout).toHaveBeenCalledWith({
            workspaceId: 'w1',
            periodMonths: 12,
            actorId: 'u1',
        })
        // The owner's first payment accepts the current offer editions.
        expect(d.legal.acceptByFirstPayment).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            paymentId: 'p1',
            ip: '10.0.0.1',
            userAgent: 'Safari',
        })
        expect(out).toEqual({ payment: PAYMENT_DTO, confirmationUrl: 'https://yk/pay' })
    })

    it('refuses a checkout and a module connection once the offer must be accepted', async () => {
        const d = build()
        const refusal = new ForbiddenError({ message: 'accept first' })
        d.legal.assertPaidActionsAllowed.mockRejectedValue(refusal)
        await expect(
            new StartWorkspaceBillingCheckoutHandler(d.rbac as never, d.payments as never, d.legal as never).execute(
                new StartWorkspaceBillingCheckoutFeature({ periodMonths: 1 }, ...CTX),
            ),
        ).rejects.toBe(refusal)
        await expect(
            new SetWorkspaceBillingModuleHandler(d.rbac as never, d.payments as never, d.legal as never).execute(
                new SetWorkspaceBillingModuleFeature({ module: 'VIDEO', enabled: true } as never, ...CTX),
            ),
        ).rejects.toBe(refusal)
        expect(d.payments.startCheckout).not.toHaveBeenCalled()
        expect(d.payments.setModule).not.toHaveBeenCalled()
        expect(d.legal.acceptByFirstPayment).not.toHaveBeenCalled()
    })

    it('connects a module and serializes the payment it needs', async () => {
        const d = build()
        const out = await new SetWorkspaceBillingModuleHandler(d.rbac as never, d.payments as never, d.legal as never).execute(
            new SetWorkspaceBillingModuleFeature({ module: 'VIDEO', enabled: true } as never, ...CTX),
        )
        expect(d.payments.setModule).toHaveBeenCalledWith({
            workspaceId: 'w1',
            module: 'VIDEO',
            enabled: true,
            actorId: 'u1',
        })
        expect(out).toEqual({
            outcome: 'PAYMENT_REQUIRED',
            payment: PAYMENT_DTO,
            confirmationUrl: 'https://yk/pay',
        })
    })

    it('returns a null payment when a module change charges nothing — disconnecting is never gated', async () => {
        const d = build()
        d.legal.assertPaidActionsAllowed.mockRejectedValue(new ForbiddenError())
        d.payments.setModule.mockResolvedValue({
            outcome: 'DISCONNECT_SCHEDULED',
            payment: null,
            confirmationUrl: null,
        })
        const out = await new SetWorkspaceBillingModuleHandler(d.rbac as never, d.payments as never, d.legal as never).execute(
            new SetWorkspaceBillingModuleFeature({ module: 'VIDEO', enabled: false } as never, ...CTX),
        )
        expect(d.legal.assertPaidActionsAllowed).not.toHaveBeenCalled()
        expect(out).toEqual({ outcome: 'DISCONNECT_SCHEDULED', payment: null, confirmationUrl: null })
    })

    it('lists the club payments', async () => {
        const d = build()
        const out = await new ListWorkspaceBillingPaymentsHandler(d.rbac as never, d.payments as never).execute(
            new ListWorkspaceBillingPaymentsFeature(...CTX),
        )
        expect(d.payments.list).toHaveBeenCalledWith('w1')
        expect(out).toEqual({ data: [PAYMENT_DTO] })
    })

    it('re-reads one payment', async () => {
        const d = build()
        const out = await new GetWorkspaceBillingPaymentHandler(d.rbac as never, d.payments as never).execute(
            new GetWorkspaceBillingPaymentFeature('p1', ...CTX),
        )
        expect(d.payments.refresh).toHaveBeenCalledWith('w1', 'p1')
        expect(out).toEqual(PAYMENT_DTO)
    })

    it('removes the card and returns the autopay state', async () => {
        const d = build()
        const out = await new RemoveWorkspaceBillingCardHandler(
            d.rbac as never,
            d.payments as never,
            d.billing as never,
        ).execute(new RemoveWorkspaceBillingCardFeature(...CTX))
        expect(d.payments.removePaymentMethod).toHaveBeenCalledWith({ workspaceId: 'w1', actorId: 'u1' })
        expect(out).toEqual({
            available: true,
            enabled: true,
            card: null,
            failedAttempts: 0,
            nextAttemptAt: null,
            lastError: null,
        })
    })

    it('sets the billing period', async () => {
        const d = build()
        const out = await new SetWorkspaceBillingPeriodHandler(d.rbac as never, d.payments as never).execute(
            new SetWorkspaceBillingPeriodFeature({ periodMonths: 12 }, ...CTX),
        )
        expect(d.payments.setBillingPeriod).toHaveBeenCalledWith({
            workspaceId: 'w1',
            periodMonths: 12,
            actorId: 'u1',
        })
        expect(out).toEqual({ billingPeriodMonths: 12 })
    })
})
