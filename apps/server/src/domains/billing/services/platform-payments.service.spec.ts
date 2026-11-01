jest.mock('../../../environments/environment', () => ({
    environment: {
        adminUrl: 'https://admin.test/',
        billing: {
            enabled: true,
            yookassa: {
                shopId: '500500',
                secretKey: 'secret',
                receiptEnabled: true,
                vatCode: 1,
            },
        },
    },
}))

import { environment } from '../../../environments/environment'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { PaymentGatewayError } from '../../payments/payment-gateway.types'
import { PlatformPaymentsService, declineReasonRu } from './platform-payments.service'

// The mocked environment, mutable per test.
const env = environment as unknown as {
    adminUrl: string | null
    billing: { enabled: boolean; yookassa: { shopId: string | undefined } }
}

const NOW = new Date('2026-11-15T12:00:00.000Z')
const PERIOD_END = new Date('2026-12-01T00:00:00.000Z')

const QUOTE = {
    lines: [{ code: 'tier', title: 'Тариф «Старт»', amount: 2990 }],
    subtotal: 2990,
    discount: 0,
    discounts: [],
    total: 2990,
    currency: 'RUB',
    periodMonths: 1,
    tierCode: 'start',
}

const payment = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    workspaceId: 'w1',
    kind: 'PERIOD',
    initiator: 'OWNER',
    module: null,
    periodMonths: 1,
    periodStart: null,
    periodEnd: null,
    amount: 2990,
    currency: 'RUB',
    lines: { lines: QUOTE.lines, discounts: [] },
    tierCode: 'start',
    status: 'PENDING',
    refundedAmount: 0,
    provider: 'YOOKASSA',
    providerPaymentId: 'yk-1',
    confirmationUrl: null,
    idempotenceKey: 'key-1',
    cardLast4: null,
    cardTitle: null,
    receiptEmail: 'owner@club.test',
    failureReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    paidAt: null,
    refundedAt: null,
    ...over,
})

const billingRow = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    workspaceId: 'w1',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: PERIOD_END,
    pastDueSince: null,
    billingPeriodMonths: 1,
    customMonthlyPrice: null,
    discountPercent: 0,
    freeUntil: null,
    setupFeeWaived: false,
    setupFeePaidAt: null,
    paidTierCode: null,
    notes: null,
    autopayEnabled: true,
    paymentMethodId: 'pm-1',
    paymentMethodTitle: 'Bank card *1111',
    paymentMethodCardLast4: '1111',
    paymentMethodSavedAt: NOW,
    autopayFailedAttempts: 0,
    autopayNextAttemptAt: null,
    autopayLastError: null,
    ...over,
})

const gatewayPayment = (over: Record<string, unknown> = {}) => ({
    providerPaymentId: 'yk-1',
    status: 'SUCCEEDED',
    confirmationUrl: null,
    amountMinor: 299000,
    currency: 'RUB',
    paymentMethod: { id: 'pm-new', saved: true, title: 'Bank card *4444', cardLast4: '4444' },
    cancellationReason: null,
    ...over,
})

const build = (o: { row?: Record<string, unknown> } = {}) => {
    const row = billingRow(o.row)
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'w1', name: 'Клуб', ownerId: 'owner' }),
        },
        user: { findUnique: jest.fn().mockResolvedValue({ email: 'owner@club.test' }) },
        platformPayment: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            findUniqueOrThrow: jest.fn().mockImplementation(async () => payment()),
            create: jest
                .fn()
                .mockImplementation(async ({ data }) => payment({ ...data, id: 'pay-new' })),
            update: jest
                .fn()
                .mockImplementation(async ({ data }) => payment({ id: 'pay-new', ...data })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workspaceBilling: {
            findUnique: jest.fn().mockResolvedValue(row),
            findUniqueOrThrow: jest.fn().mockResolvedValue(row),
            update: jest.fn().mockImplementation(async ({ data }) => ({
                ...row,
                ...data,
                autopayFailedAttempts:
                    typeof data.autopayFailedAttempts === 'object'
                        ? row.autopayFailedAttempts + 1
                        : (data.autopayFailedAttempts ?? row.autopayFailedAttempts),
            })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workspaceModuleEntitlement: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
    const billing = {
        enabled: true,
        pricing: {
            currency: 'RUB',
            annualDiscountPercent: 15,
            modules: [
                { code: 'VIDEO', name: 'Видео', priceMonthly: 990 },
                { code: 'ONLINE_PAYMENTS', name: 'Онлайн-оплата', priceMonthly: 490 },
                { code: 'BRANDED_APP', name: 'Приложение', priceMonthly: 2990 },
            ],
        },
        getBilling: jest.fn().mockResolvedValue(row),
        quoteWorkspaceBilling: jest.fn().mockResolvedValue(QUOTE),
    }
    const gateway = {
        createPayment: jest.fn().mockResolvedValue(
            gatewayPayment({ status: 'PENDING', confirmationUrl: 'https://yk/confirm' }),
        ),
        getPayment: jest.fn().mockResolvedValue(gatewayPayment()),
        refund: jest.fn().mockResolvedValue(undefined),
    }
    const audit = { record: jest.fn() }
    const producer = { notifyUser: jest.fn().mockResolvedValue(true) }
    const notifications = { sendNotification: jest.fn().mockResolvedValue('n1') }
    const service = new PlatformPaymentsService(
        prisma as never,
        billing as never,
        gateway as never,
        audit as never,
        producer as never,
        notifications as never,
    )
    return { service, prisma, billing, gateway, audit, producer, notifications, row }
}

beforeEach(() => {
    env.adminUrl = 'https://admin.test/'
    env.billing.enabled = true
    env.billing.yookassa.shopId = '500500'
})

describe('PlatformPaymentsService — checkout', () => {
    const checkout = (s: PlatformPaymentsService, periodMonths = 1) =>
        s.startCheckout({ workspaceId: 'w1', periodMonths, actorId: 'owner', now: NOW })

    it('is refused when the platform shop is not configured', async () => {
        env.billing.yookassa.shopId = undefined
        const { service, gateway } = build()
        await expect(checkout(service)).rejects.toBeInstanceOf(BadRequestError)
        expect(gateway.createPayment).not.toHaveBeenCalled()
    })

    it('creates a redirect payment that saves the card, receipt to the owner', async () => {
        const { service, prisma, gateway, billing } = build({
            row: { status: 'PAST_DUE', currentPeriodEnd: null, paymentMethodId: null },
        })
        const res = await checkout(service)
        expect(billing.quoteWorkspaceBilling).toHaveBeenCalledWith('w1', {
            periodStart: NOW,
            periodMonths: 1,
            now: NOW,
        })
        const created = prisma.platformPayment.create.mock.calls[0][0].data
        expect(created).toMatchObject({
            kind: 'PERIOD',
            initiator: 'OWNER',
            amount: 2990,
            provider: 'YOOKASSA',
            receiptEmail: 'owner@club.test',
            tierCode: 'start',
        })
        const [creds, input] = gateway.createPayment.mock.calls[0]
        expect(creds).toMatchObject({ provider: 'YOOKASSA', shopId: '500500' })
        expect(input).toMatchObject({
            savePaymentMethod: true,
            amount: 2990,
            customerEmail: 'owner@club.test',
            returnUrl: 'https://admin.test/workspace/w1/billing?payment=pay-new',
            idempotenceKey: created.idempotenceKey,
        })
        expect(res.confirmationUrl).toBe('https://yk/confirm')
    })

    it('switching to annual records the new billing period', async () => {
        const { service, prisma, audit } = build()
        await checkout(service, 12)
        expect(prisma.workspaceBilling.update).toHaveBeenCalledWith({
            where: { workspaceId: 'w1' },
            data: { billingPeriodMonths: 12 },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'workspace.billingPeriod' }),
        )
    })

    it('reuses a fresh pending checkout instead of a second payment', async () => {
        const { service, prisma, gateway } = build()
        prisma.platformPayment.findFirst.mockResolvedValue(
            payment({ confirmationUrl: 'https://yk/old' }),
        )
        const res = await checkout(service)
        expect(res.confirmationUrl).toBe('https://yk/old')
        expect(gateway.createPayment).not.toHaveBeenCalled()
    })

    it('refuses a free period', async () => {
        const { service, billing } = build()
        billing.quoteWorkspaceBilling.mockResolvedValue({ ...QUOTE, total: 0 })
        await expect(checkout(service)).rejects.toThrow('Оплачивать нечего')
    })

    it('cancels the row when YooKassa refuses or there is no return URL', async () => {
        const { service, prisma, gateway } = build()
        gateway.createPayment.mockRejectedValue(new PaymentGatewayError('boom', 500))
        await expect(checkout(service)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.platformPayment.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELED' }) }),
        )

        env.adminUrl = null
        const second = build()
        await expect(checkout(second.service)).rejects.toBeInstanceOf(BadRequestError)
        expect(second.gateway.createPayment).not.toHaveBeenCalled()
    })
})

describe('PlatformPaymentsService — provider reports', () => {
    it('ignores a payment that is not ours', async () => {
        const { service, prisma } = build()
        expect(await service.applyGateway(gatewayPayment() as never, NOW)).toBe('unchanged')
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('a succeeded period extends the paid period from its end, saves the card, clears past due', async () => {
        const { service, prisma, audit } = build()
        prisma.platformPayment.findUnique.mockResolvedValue(payment())
        expect(await service.applyGateway(gatewayPayment() as never, NOW)).toBe('applied')
        const update = prisma.workspaceBilling.update.mock.calls[0][0].data
        expect(update).toMatchObject({
            status: 'ACTIVE',
            currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
            pastDueSince: null,
            setupFeePaidAt: NOW,
            paidTierCode: 'start',
            autopayFailedAttempts: 0,
            paymentMethodId: 'pm-new',
            paymentMethodCardLast4: '4444',
        })
        expect(prisma.platformPayment.update).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { periodStart: PERIOD_END, periodEnd: new Date('2027-01-01T00:00:00.000Z') },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'workspace.billingPayment' }),
        )
    })

    it('a payment made during the trial keeps the trial running', async () => {
        const trialEnd = new Date('2026-11-25T00:00:00.000Z')
        const { service, prisma } = build({
            row: { status: 'TRIAL', trialEndsAt: trialEnd, currentPeriodEnd: null },
        })
        prisma.platformPayment.findUnique.mockResolvedValue(payment())
        await service.applyGateway(gatewayPayment() as never, NOW)
        expect(prisma.workspaceBilling.update.mock.calls[0][0].data).toMatchObject({
            status: 'TRIAL',
            currentPeriodEnd: new Date('2026-12-25T00:00:00.000Z'),
        })
    })

    it('a duplicate report changes nothing', async () => {
        const { service, prisma, audit } = build()
        prisma.platformPayment.findUnique.mockResolvedValue(payment())
        prisma.platformPayment.updateMany.mockResolvedValue({ count: 0 })
        expect(await service.applyGateway(gatewayPayment() as never, NOW)).toBe('unchanged')
        expect(prisma.workspaceBilling.update).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('refuses an amount other than what was asked', async () => {
        const { service, prisma } = build()
        prisma.platformPayment.findUnique.mockResolvedValue(payment())
        expect(
            await service.applyGateway(gatewayPayment({ amountMinor: 100 }) as never, NOW),
        ).toBe('unchanged')
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(
            await service.applyGateway(gatewayPayment({ status: 'PENDING' }) as never, NOW),
        ).toBe('unchanged')
    })

    it('a paid module turns the module on', async () => {
        const { service, prisma } = build()
        prisma.platformPayment.findUnique.mockResolvedValue(
            payment({ kind: 'MODULE', module: 'VIDEO' }),
        )
        await service.applyGateway(gatewayPayment() as never, NOW)
        expect(prisma.workspaceModuleEntitlement.create).toHaveBeenCalledWith({
            data: { workspaceId: 'w1', module: 'VIDEO', mode: 'PAID' },
        })
        expect(prisma.workspaceBilling.update.mock.calls[0][0].data).toMatchObject({
            paymentMethodId: 'pm-new',
        })
    })

    it("a canceled owner checkout is just canceled; a refused renewal counts, retries and tells the owner", async () => {
        const owner = build()
        owner.prisma.platformPayment.findUnique.mockResolvedValue(payment())
        expect(
            await owner.service.applyGateway(gatewayPayment({ status: 'CANCELED' }) as never, NOW),
        ).toBe('failed')
        expect(owner.prisma.workspaceBilling.update).not.toHaveBeenCalled()

        const renewal = build()
        renewal.prisma.platformPayment.findUnique.mockResolvedValue(
            payment({ initiator: 'AUTOPAY' }),
        )
        await renewal.service.applyGateway(
            gatewayPayment({ status: 'CANCELED', cancellationReason: 'insufficient_funds' }) as never,
            NOW,
        )
        expect(renewal.prisma.workspaceBilling.update.mock.calls[0][0].data).toMatchObject({
            autopayFailedAttempts: { increment: 1 },
            autopayLastError: 'на карте недостаточно средств',
        })
        expect(renewal.prisma.workspaceBilling.update.mock.calls[1][0].data).toEqual({
            autopayNextAttemptAt: new Date('2026-11-16T12:00:00.000Z'),
        })
        expect(renewal.producer.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'owner',
                kind: 'platformBilling.chargeFailed',
                refId: 'pay-1',
            }),
        )
        expect(renewal.notifications.sendNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'EMAIL', identity: 'owner@club.test' }),
        )
    })

    it('a revoked card is forgotten and not retried', async () => {
        const { service, prisma } = build({ row: { paymentMethodId: null } })
        prisma.platformPayment.findUnique.mockResolvedValue(payment({ initiator: 'AUTOPAY' }))
        await service.applyGateway(
            gatewayPayment({ status: 'CANCELED', cancellationReason: 'permission_revoked' }) as never,
            NOW,
        )
        expect(prisma.workspaceBilling.update.mock.calls[0][0].data).toMatchObject({
            paymentMethodId: null,
        })
        expect(prisma.workspaceBilling.update.mock.calls[1][0].data).toEqual({
            autopayNextAttemptAt: null,
        })
    })

    it('a notification failure never fails the bookkeeping', async () => {
        const { service, prisma, producer } = build()
        producer.notifyUser.mockRejectedValue(new Error('push down'))
        prisma.platformPayment.findUnique.mockResolvedValue(payment({ initiator: 'AUTOPAY' }))
        await expect(
            service.applyGateway(gatewayPayment({ status: 'CANCELED' }) as never, NOW),
        ).resolves.toBe('failed')
    })

    it('refresh re-reads only a pending payment of this club', async () => {
        const { service, prisma, gateway } = build()
        prisma.platformPayment.findFirst.mockResolvedValueOnce(null)
        await expect(service.refresh('w1', 'nope')).rejects.toBeInstanceOf(NotFoundError)

        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment({ status: 'SUCCEEDED' }))
        await service.refresh('w1', 'pay-1')
        expect(gateway.getPayment).not.toHaveBeenCalled()

        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment())
        await service.refresh('w1', 'pay-1')
        expect(gateway.getPayment).toHaveBeenCalledWith(expect.anything(), 'yk-1')

        gateway.getPayment.mockRejectedValueOnce(new PaymentGatewayError('down', null))
        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment())
        await expect(service.refresh('w1', 'pay-1')).resolves.toBeDefined()
    })
})

describe('PlatformPaymentsService — renewal', () => {
    const renew = (s: PlatformPaymentsService, now = NOW, initiator: 'AUTOPAY' | 'PLATFORM' = 'AUTOPAY') =>
        s.renew('w1', { initiator, now })
    const dueNow = new Date(PERIOD_END.getTime() - 60 * 60 * 1000)

    it('skips a club that is not due, has no card or has autopay off', async () => {
        expect((await renew(build().service)).outcome).toBe('SKIPPED')
        expect(
            (await renew(build({ row: { paymentMethodId: null } }).service, dueNow)).reason,
        ).toBe('Нет сохранённой карты')
        expect(
            (await renew(build({ row: { autopayEnabled: false } }).service, dueNow)).reason,
        ).toBe('Автосписание выключено')
        expect(
            (await renew(build({ row: { status: 'SUSPENDED' } }).service, dueNow)).outcome,
        ).toBe('SKIPPED')
        env.billing.enabled = false
        expect((await renew(build().service, dueNow)).outcome).toBe('SKIPPED')
    })

    it('charges the saved card once per period and attempt', async () => {
        const { service, prisma, gateway } = build()
        gateway.createPayment.mockResolvedValue(gatewayPayment({ providerPaymentId: 'yk-9' }))
        prisma.platformPayment.findUnique
            .mockResolvedValueOnce(null) // the idempotence key is free
            .mockResolvedValueOnce(payment({ initiator: 'AUTOPAY', providerPaymentId: 'yk-9' }))
        const res = await renew(service, dueNow)
        expect(res.outcome).toBe('CHARGED')
        const data = prisma.platformPayment.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            initiator: 'AUTOPAY',
            amount: 2990,
            periodStart: PERIOD_END,
            idempotenceKey: `renewal:w1:${PERIOD_END.toISOString()}:0`,
        })
        expect(gateway.createPayment.mock.calls[0][1]).toMatchObject({
            paymentMethodId: 'pm-1',
            idempotenceKey: data.idempotenceKey,
        })
    })

    it('does not charge again when the key is taken or a charge is in flight', async () => {
        const taken = build()
        taken.prisma.platformPayment.findUnique.mockResolvedValue(
            payment({ status: 'SUCCEEDED' }),
        )
        expect((await renew(taken.service, dueNow)).outcome).toBe('SKIPPED')

        const young = build()
        young.prisma.platformPayment.findUnique.mockResolvedValue(
            payment({ providerPaymentId: null, createdAt: dueNow }),
        )
        expect((await renew(young.service, dueNow)).outcome).toBe('SKIPPED')

        const inflight = build()
        inflight.prisma.platformPayment.findFirst.mockResolvedValue({ id: 'other' })
        expect((await renew(inflight.service, dueNow)).reason).toBe(
            'Предыдущий платёж ещё обрабатывается',
        )

        const race = build()
        race.prisma.platformPayment.create.mockRejectedValue({ code: 'P2002' })
        expect((await renew(race.service, dueNow)).outcome).toBe('SKIPPED')

        for (const s of [taken, young, inflight, race]) {
            expect(s.gateway.createPayment).not.toHaveBeenCalled()
        }
    })

    it('re-sends a stale unanswered charge with the same key', async () => {
        const { service, prisma, gateway } = build()
        const stale = payment({
            providerPaymentId: null,
            idempotenceKey: `renewal:w1:${PERIOD_END.toISOString()}:0`,
            createdAt: new Date(dueNow.getTime() - 60 * 60 * 1000),
        })
        prisma.platformPayment.findUnique.mockResolvedValueOnce(stale)
        await renew(service, dueNow)
        expect(prisma.platformPayment.create).not.toHaveBeenCalled()
        expect(gateway.createPayment.mock.calls[0][1].idempotenceKey).toBe(stale.idempotenceKey)
    })

    it('a refused card is a failure; an unreachable provider is retried later', async () => {
        const refused = build()
        refused.gateway.createPayment.mockRejectedValue(
            new PaymentGatewayError('bad method', 400, 'Payment method is not available'),
        )
        expect((await renew(refused.service, dueNow)).outcome).toBe('FAILED')
        expect(refused.prisma.platformPayment.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'CANCELED' }),
            }),
        )

        const down = build()
        down.gateway.createPayment.mockRejectedValue(new PaymentGatewayError('timeout', null))
        const res = await renew(down.service, dueNow)
        expect(res.outcome).toBe('SKIPPED')
        expect(down.prisma.platformPayment.updateMany).not.toHaveBeenCalled()

        const pending = build()
        pending.gateway.createPayment.mockResolvedValue(gatewayPayment({ status: 'PENDING' }))
        expect((await renew(pending.service, dueNow)).outcome).toBe('PENDING')

        const declined = build()
        declined.gateway.createPayment.mockResolvedValue(gatewayPayment({ status: 'CANCELED' }))
        declined.prisma.platformPayment.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(payment({ initiator: 'AUTOPAY' }))
        expect((await renew(declined.service, dueNow)).outcome).toBe('FAILED')
    })

    it('a bill of 0 extends the period without a provider call, once', async () => {
        const { service, prisma, billing, gateway, audit } = build({
            row: { paymentMethodId: null },
        })
        billing.quoteWorkspaceBilling.mockResolvedValue({ ...QUOTE, total: 0 })
        const res = await renew(service, dueNow)
        expect(res.outcome).toBe('EXTENDED_FREE')
        expect(gateway.createPayment).not.toHaveBeenCalled()
        expect(prisma.platformPayment.create.mock.calls[0][0].data).toMatchObject({
            amount: 0,
            status: 'SUCCEEDED',
            idempotenceKey: `renewal:w1:${PERIOD_END.toISOString()}:free`,
        })
        expect(prisma.workspaceBilling.updateMany).toHaveBeenCalledWith({
            where: { id: 'b1', status: 'ACTIVE', currentPeriodEnd: PERIOD_END },
            data: expect.objectContaining({
                status: 'ACTIVE',
                currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
            }),
        })
        expect(audit.record).toHaveBeenCalled()

        const again = build({ row: { paymentMethodId: null } })
        again.billing.quoteWorkspaceBilling.mockResolvedValue({ ...QUOTE, total: 0 })
        again.prisma.platformPayment.create.mockRejectedValue({ code: 'P2002' })
        expect((await renew(again.service, dueNow)).outcome).toBe('SKIPPED')

        const moved = build()
        moved.billing.quoteWorkspaceBilling.mockResolvedValue({ ...QUOTE, total: 0 })
        moved.prisma.workspaceBilling.updateMany.mockResolvedValue({ count: 0 })
        expect((await renew(moved.service, dueNow)).outcome).toBe('SKIPPED')
    })

    it('the console retries a suspended club', async () => {
        const { service, gateway } = build({
            row: { status: 'SUSPENDED', pastDueSince: new Date('2026-11-01T00:00:00Z') },
        })
        await renew(service, NOW, 'PLATFORM')
        expect(gateway.createPayment).toHaveBeenCalled()
    })
})

describe('PlatformPaymentsService — modules', () => {
    const set = (s: PlatformPaymentsService, enabled: boolean, module = 'VIDEO') =>
        s.setModule({ workspaceId: 'w1', module: module as 'VIDEO', enabled, actorId: 'owner', now: NOW })

    it('the platform wins: OFF cannot be connected, a comp cannot be disconnected', async () => {
        const off = build()
        off.prisma.workspaceModuleEntitlement.findUnique.mockResolvedValue({ mode: 'OFF' })
        await expect(set(off.service, true)).rejects.toThrow('отключён командой ClubSpace')

        const comp = build()
        comp.prisma.workspaceModuleEntitlement.findUnique.mockResolvedValue({
            mode: 'COMP',
            compUntil: new Date('2027-01-01Z'),
        })
        await expect(set(comp.service, true)).rejects.toThrow('уже подключён бесплатно')
        await expect(set(comp.service, false)).rejects.toThrow('предоставлен бесплатно')

        env.billing.enabled = false
        await expect(set(build().service, true)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('connecting mid-period charges the rest of the period on the saved card', async () => {
        const { service, prisma, gateway } = build()
        gateway.createPayment.mockResolvedValue(
            gatewayPayment({ providerPaymentId: 'yk-m', amountMinor: 52800 }),
        )
        prisma.platformPayment.findUnique.mockResolvedValue(
            payment({ kind: 'MODULE', module: 'VIDEO', amount: 528, providerPaymentId: 'yk-m' }),
        )
        prisma.platformPayment.findUniqueOrThrow.mockResolvedValue(
            payment({ kind: 'MODULE', status: 'SUCCEEDED' }),
        )
        const res = await set(service, true)
        expect(res.outcome).toBe('CONNECTED')
        // 15.5 of November's 30 days left of 990.
        expect(prisma.platformPayment.create.mock.calls[0][0].data).toMatchObject({
            kind: 'MODULE',
            module: 'VIDEO',
            amount: 512,
            periodEnd: PERIOD_END,
        })
        expect(gateway.createPayment.mock.calls[0][1]).toMatchObject({ paymentMethodId: 'pm-1' })
    })

    it('without a saved card the club pays on YooKassa first', async () => {
        const { service, gateway } = build({ row: { paymentMethodId: null } })
        const res = await set(service, true)
        expect(res.outcome).toBe('PAYMENT_REQUIRED')
        expect(res.confirmationUrl).toBe('https://yk/confirm')
        expect(gateway.createPayment.mock.calls[0][1]).toMatchObject({ savePaymentMethod: true })
    })

    it('a refused or pending saved-card charge is reported', async () => {
        const refused = build()
        refused.gateway.createPayment.mockResolvedValue(gatewayPayment({ status: 'CANCELED' }))
        refused.prisma.platformPayment.findUniqueOrThrow.mockResolvedValue(
            payment({ failureReason: 'insufficient_funds' }),
        )
        await expect(set(refused.service, true)).rejects.toThrow('недостаточно средств')

        const pending = build()
        pending.gateway.createPayment.mockResolvedValue(gatewayPayment({ status: 'PENDING' }))
        expect((await set(pending.service, true)).outcome).toBe('PAYMENT_PENDING')

        const down = build()
        down.gateway.createPayment.mockRejectedValue(new PaymentGatewayError('down', 503))
        await expect(set(down.service, true)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('the trial and free periods connect without a charge; overdue clubs pay first', async () => {
        const trial = build({ row: { status: 'TRIAL', currentPeriodEnd: null } })
        expect((await set(trial.service, true)).outcome).toBe('CONNECTED')
        expect(trial.gateway.createPayment).not.toHaveBeenCalled()
        expect(trial.prisma.workspaceModuleEntitlement.create).toHaveBeenCalled()

        const free = build({ row: { freeUntil: new Date('2027-01-01Z') } })
        expect((await set(free.service, true)).outcome).toBe('CONNECTED')

        const overdue = build({ row: { status: 'PAST_DUE' } })
        await expect(set(overdue.service, true)).rejects.toThrow('Сначала оплатите')
    })

    it('disconnecting keeps the module to the period end; reconnecting before it is free', async () => {
        const paid = build()
        paid.prisma.workspaceModuleEntitlement.findUnique.mockResolvedValue({
            id: 'e1',
            mode: 'PAID',
            cancelAt: null,
        })
        expect((await set(paid.service, false)).outcome).toBe('DISCONNECT_SCHEDULED')
        expect(paid.prisma.workspaceModuleEntitlement.update).toHaveBeenCalledWith({
            where: { id: 'e1' },
            data: { cancelAt: PERIOD_END },
        })
        await expect(set(paid.service, true)).rejects.toThrow('уже подключён')

        const trial = build({ row: { status: 'TRIAL', currentPeriodEnd: null } })
        trial.prisma.workspaceModuleEntitlement.findUnique.mockResolvedValue({
            id: 'e1',
            mode: 'PAID',
            cancelAt: null,
        })
        expect((await set(trial.service, false)).outcome).toBe('DISCONNECTED')

        const scheduled = build()
        scheduled.prisma.workspaceModuleEntitlement.findUnique.mockResolvedValue({
            id: 'e1',
            mode: 'PAID',
            cancelAt: PERIOD_END,
        })
        await expect(set(scheduled.service, false)).rejects.toThrow('уже отключится')
        expect((await set(scheduled.service, true)).outcome).toBe('RESTORED')

        await expect(set(build().service, false)).rejects.toThrow('не подключён')
    })
})

describe('PlatformPaymentsService — card, autopay, refund', () => {
    it('removes the saved card', async () => {
        const { service, prisma, audit } = build()
        await service.removePaymentMethod({ workspaceId: 'w1', actorId: 'owner' })
        expect(prisma.workspaceBilling.update.mock.calls[0][0].data).toMatchObject({
            paymentMethodId: null,
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'workspace.billingCardRemoved' }),
        )
        await expect(
            build({ row: { paymentMethodId: null } }).service.removePaymentMethod({
                workspaceId: 'w1',
                actorId: 'owner',
            }),
        ).rejects.toThrow('Сохранённой карты нет')
    })

    it('switches autopay', async () => {
        const { service, prisma, audit } = build()
        await service.setAutopay({ workspaceId: 'w1', enabled: false, actorId: 'admin' })
        expect(prisma.workspaceBilling.update).toHaveBeenCalledWith({
            where: { workspaceId: 'w1' },
            data: { autopayEnabled: false },
        })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.billingAutopay',
            metadata: { from: true, to: false },
        })
    })

    const refund = (s: PlatformPaymentsService, amount?: number) =>
        s.refund({ workspaceId: 'w1', paymentId: 'pay-1', amount, actorId: 'admin', now: NOW })

    it('refunds part, then the rest, audited', async () => {
        const { service, prisma, gateway, audit } = build()
        prisma.platformPayment.findFirst.mockResolvedValue(payment({ status: 'SUCCEEDED' }))
        await refund(service, 1000)
        expect(gateway.refund.mock.calls[0][1]).toMatchObject({
            amount: 1000,
            providerPaymentId: 'yk-1',
            idempotenceKey: 'platform-refund-pay-1-0-1000',
        })
        expect(prisma.platformPayment.updateMany).toHaveBeenCalledWith({
            where: { id: 'pay-1', status: 'SUCCEEDED', refundedAmount: 0 },
            data: { refundedAmount: 1000, refundedAt: NOW, status: 'SUCCEEDED' },
        })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.billingRefund',
            metadata: { amount: 1000, refundedTotal: 1000 },
        })

        prisma.platformPayment.findFirst.mockResolvedValue(
            payment({ status: 'SUCCEEDED', refundedAmount: 1000 }),
        )
        await refund(service)
        expect(prisma.platformPayment.updateMany.mock.calls[1][0].data).toMatchObject({
            refundedAmount: 2990,
            status: 'REFUNDED',
        })
    })

    it('refuses what cannot be refunded', async () => {
        const { service, prisma, gateway } = build()
        prisma.platformPayment.findFirst.mockResolvedValueOnce(null)
        await expect(refund(service)).rejects.toBeInstanceOf(NotFoundError)
        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment({ status: 'REFUNDED' }))
        await expect(refund(service)).rejects.toThrow('уже возвращены')
        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment({ status: 'PENDING' }))
        await expect(refund(service)).rejects.toThrow('только проведённый')
        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment({ status: 'SUCCEEDED' }))
        await expect(refund(service, 5000)).rejects.toThrow('от 1 до')
        expect(gateway.refund).not.toHaveBeenCalled()

        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment({ status: 'SUCCEEDED' }))
        gateway.refund.mockRejectedValueOnce(new PaymentGatewayError('no', 400, 'Нельзя'))
        await expect(refund(service)).rejects.toThrow('не провела возврат: Нельзя')

        prisma.platformPayment.findFirst.mockResolvedValueOnce(payment({ status: 'SUCCEEDED' }))
        prisma.platformPayment.updateMany.mockResolvedValueOnce({ count: 0 })
        await expect(refund(service)).rejects.toThrow('уже записан')
    })

    it('lists the club payments newest first', async () => {
        const { service, prisma } = build()
        await service.list('w1')
        expect(prisma.platformPayment.findMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1' },
            orderBy: { createdAt: 'desc' },
            take: 50,
        })
    })

    it('explains decline reasons in Russian', () => {
        expect(declineReasonRu('card_expired')).toBe('истёк срок действия карты')
        expect(declineReasonRu('something_new')).toBe('платёж отклонён')
        expect(declineReasonRu(null)).toBe('платёж отклонён')
    })
})
