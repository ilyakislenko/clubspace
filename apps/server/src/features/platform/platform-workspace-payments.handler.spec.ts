jest.mock('../../environments/environment', () => ({
    environment: { billing: { enabled: true, graceDays: 7 } },
}))
jest.mock('./platform-workspace-billing-view', () => ({
    loadPlatformWorkspaceBilling: jest.fn(),
}))

import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ListPlatformWorkspacePaymentsHandler } from './list-platform-workspace-payments.handler'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'
import {
    ListPlatformWorkspacePaymentsFeature,
    RefundPlatformWorkspacePaymentFeature,
    RetryPlatformWorkspacePaymentFeature,
    SetPlatformWorkspaceAutopayFeature,
} from './platform-workspace-payments.feature'
import { RefundPlatformWorkspacePaymentHandler } from './refund-platform-workspace-payment.handler'
import { RetryPlatformWorkspacePaymentHandler } from './retry-platform-workspace-payment.handler'
import { SetPlatformWorkspaceAutopayHandler } from './set-platform-workspace-autopay.handler'

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

const loadView = loadPlatformWorkspaceBilling as jest.Mock

const build = (o: { ws?: unknown } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue('ws' in o ? o.ws : { id: 'w1' }),
        },
    }
    const payments = {
        list: jest.fn().mockResolvedValue([PAYMENT]),
        renew: jest.fn().mockResolvedValue({ outcome: 'CHARGED', reason: null, payment: PAYMENT }),
        refund: jest.fn().mockResolvedValue(PAYMENT),
        setAutopay: jest.fn().mockResolvedValue(undefined),
    }
    const billing = {}
    const audit = {}
    const handlers = {
        list: (sa: boolean) =>
            new ListPlatformWorkspacePaymentsHandler(prisma as never, payments as never).execute(
                new ListPlatformWorkspacePaymentsFeature('w1', 'u1', sa),
            ),
        retry: (sa: boolean) =>
            new RetryPlatformWorkspacePaymentHandler(prisma as never, payments as never).execute(
                new RetryPlatformWorkspacePaymentFeature('w1', 'u1', sa),
            ),
        refund: (sa: boolean) =>
            new RefundPlatformWorkspacePaymentHandler(prisma as never, payments as never).execute(
                new RefundPlatformWorkspacePaymentFeature(
                    'p1',
                    { amount: 1000, reason: 'Двойное списание' } as never,
                    'w1',
                    'u1',
                    sa,
                ),
            ),
        autopay: (sa: boolean) =>
            new SetPlatformWorkspaceAutopayHandler(
                prisma as never,
                payments as never,
                billing as never,
                audit as never,
            ).execute(new SetPlatformWorkspaceAutopayFeature({ enabled: false }, 'w1', 'u1', sa)),
    }
    return { prisma, payments, billing, audit, handlers }
}

const NAMES = ['list', 'retry', 'refund', 'autopay'] as const
const METHOD = { list: 'list', retry: 'renew', refund: 'refund', autopay: 'setAutopay' } as const

describe('platform workspace payment handlers', () => {
    beforeEach(() => loadView.mockReset())

    it.each(NAMES)('%s refuses a non-super-admin', async (name) => {
        const d = build()
        await expect(d.handlers[name](false)).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(d.payments[METHOD[name]]).not.toHaveBeenCalled()
    })

    it.each(NAMES)('%s 404s on an unknown club', async (name) => {
        const d = build({ ws: null })
        await expect(d.handlers[name](true)).rejects.toBeInstanceOf(NotFoundError)
        expect(d.payments[METHOD[name]]).not.toHaveBeenCalled()
    })

    it('lists up to 100 payments of the club', async () => {
        const d = build()
        const out = await d.handlers.list(true)
        expect(d.payments.list).toHaveBeenCalledWith('w1', 100)
        expect(out).toEqual({ data: [PAYMENT_DTO] })
    })

    it('retries the renewal as the platform', async () => {
        const d = build()
        const out = await d.handlers.retry(true)
        expect(d.payments.renew).toHaveBeenCalledWith('w1', { initiator: 'PLATFORM' })
        expect(out).toEqual({ outcome: 'CHARGED', reason: null, payment: PAYMENT_DTO })
    })

    it('returns a null payment when the retry charges nothing', async () => {
        const d = build()
        d.payments.renew.mockResolvedValue({ outcome: 'SKIPPED', reason: 'not due', payment: null })
        expect(await d.handlers.retry(true)).toEqual({
            outcome: 'SKIPPED',
            reason: 'not due',
            payment: null,
        })
    })

    it('refunds with the amount, reason and operator', async () => {
        const d = build()
        const out = await d.handlers.refund(true)
        expect(d.payments.refund).toHaveBeenCalledWith({
            workspaceId: 'w1',
            paymentId: 'p1',
            amount: 1000,
            reason: 'Двойное списание',
            actorId: 'u1',
        })
        expect(out).toEqual(PAYMENT_DTO)
    })

    it('switches autopay and returns the console view', async () => {
        const d = build()
        const view = { billing: { status: 'ACTIVE' } }
        loadView.mockResolvedValue(view)
        const out = await d.handlers.autopay(true)
        expect(d.payments.setAutopay).toHaveBeenCalledWith({
            workspaceId: 'w1',
            enabled: false,
            actorId: 'u1',
        })
        expect(loadView).toHaveBeenCalledWith(
            { prisma: d.prisma, billing: d.billing, audit: d.audit },
            'w1',
        )
        expect(out).toBe(view)
    })
})
