jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        rootUrl: 'https://api.example.com/',
        appUrl: 'https://app.example.com',
        billing: { enabled: true },
    },
}))

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { CreatePaymentFeature } from './create-payment.feature'
import { CreatePaymentHandler } from './create-payment.handler'
import { GetMyPaymentFeature } from './get-my-payment.feature'
import { GetMyPaymentHandler } from './get-my-payment.handler'
import { GetOnlinePurchaseOptionsFeature } from './get-online-purchase-options.feature'
import { GetOnlinePurchaseOptionsHandler } from './get-online-purchase-options.handler'

const KEY = 'unit-test-encryption-key'

const workspace = (over: Record<string, unknown> = {}) => ({
    name: 'Клуб',
    ownerId: 'owner-1',
    timezone: 'Europe/Moscow',
    subscriptionEnabled: true,
    billing: null,
    moduleEntitlements: [],
    ...over,
})
const settings = {
    workspaceId: 'ws-1',
    provider: 'YOOKASSA',
    shopId: '123456',
    secretKeyEncrypted: encryptPaymentSecret('live_key_1234', KEY),
    webhookSecretEncrypted: null,
    receiptEnabled: true,
    vatCode: 1,
    paymentSubject: 'service',
    paymentMode: 'full_prepayment',
}
const plan = {
    id: 'plan-1',
    name: 'Безлимит',
    description: null,
    price: 4500,
    currency: 'RUB',
    durationDays: 30,
    classCount: null,
    directions: [] as Array<{ directionId: string; direction: Record<string, unknown> }>,
}
const paymentRow = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    planId: 'plan-1',
    planName: 'Безлимит',
    subscriptionId: null,
    provider: 'YOOKASSA',
    providerPaymentId: null,
    confirmationUrl: null,
    amount: 4500,
    currency: 'RUB',
    status: 'PENDING',
    idempotenceKey: 'idem-1',
    activationError: null,
    createdAt: new Date('2026-11-01T09:00:00Z'),
    updatedAt: new Date('2026-11-01T09:00:00Z'),
    paidAt: null,
    refundedAt: null,
    ...over,
})

const prismaFor = (opts: {
    workspace?: Record<string, unknown> | null
    member?: Record<string, unknown> | null
    settings?: Record<string, unknown> | null
    plan?: Record<string, unknown> | null
    plans?: Array<Record<string, unknown>>
    recent?: Record<string, unknown> | null
    // Directions the member trains in (their groups').
    memberDirections?: string[]
} = {}) => ({
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue(opts.workspace === undefined ? workspace() : opts.workspace),
    },
    workspaceMember: {
        findFirst: jest
            .fn()
            .mockResolvedValue(
                opts.member === undefined ? { id: 'm-1', subscriptions: [] } : opts.member,
            ),
    },
    workspacePaymentSettings: {
        findUnique: jest
            .fn()
            .mockResolvedValue(opts.settings === undefined ? settings : opts.settings),
    },
    plan: {
        findFirst: jest.fn().mockResolvedValue(opts.plan === undefined ? plan : opts.plan),
        findMany: jest.fn().mockResolvedValue(opts.plans ?? [plan]),
    },
    groupMember: {
        findMany: jest
            .fn()
            .mockResolvedValue(
                (opts.memberDirections ?? []).map((directionId) => ({
                    group: { directionId },
                })),
            ),
    },
    groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'member@example.com' }),
    },
    payment: {
        findFirst: jest.fn().mockResolvedValue(opts.recent ?? null),
        create: jest.fn(async ({ data }) => paymentRow(data)),
        update: jest.fn(async ({ data }) => paymentRow(data)),
    },
})

const liveClassPack = {
    id: 'm-1',
    subscriptions: [
        {
            status: 'ACTIVE',
            startDate: new Date('2026-10-01T00:00:00Z'),
            endDate: new Date('2099-01-01T00:00:00Z'),
            classesTotal: 8,
            classesRemaining: 2,
            directions: [] as { directionId: string }[],
        },
    ],
}

describe('createPayment', () => {
    const gatewayOk = () => ({
        createPayment: jest.fn().mockResolvedValue({
            providerPaymentId: 'yk-1',
            status: 'PENDING',
            confirmationUrl: 'https://yoomoney.ru/checkout/yk-1',
            amountMinor: 450000,
            currency: 'RUB',
        }),
    })
    const run = (
        prisma: ReturnType<typeof prismaFor>,
        gateway = gatewayOk(),
        userId = 'u-1',
    ) =>
        new CreatePaymentHandler(prisma as never, gateway as never).execute(
            new CreatePaymentFeature({ planId: 'plan-1' }, 'ws-1', userId),
        )

    it('creates the provider payment and returns its confirmation URL', async () => {
        const prisma = prismaFor()
        const gateway = gatewayOk()
        const out = await run(prisma, gateway)
        const created = prisma.payment.create.mock.calls[0][0].data
        expect(created).toMatchObject({
            workspaceId: 'ws-1',
            userId: 'u-1',
            planId: 'plan-1',
            planName: 'Безлимит',
            provider: 'YOOKASSA',
            amount: 4500,
            currency: 'RUB',
        })
        expect(created.idempotenceKey).toMatch(/^[0-9a-f-]{36}$/)
        const [creds, input] = gateway.createPayment.mock.calls[0]
        expect(creds).toMatchObject({ provider: 'YOOKASSA', secretKey: 'live_key_1234' })
        expect(input).toMatchObject({
            paymentId: 'pay-1',
            workspaceId: 'ws-1',
            idempotenceKey: created.idempotenceKey,
            amount: 4500,
            currency: 'RUB',
            returnUrl: 'https://app.example.com/payment/pay-1',
            customerEmail: 'member@example.com',
            itemName: 'Абонемент «Безлимит»',
        })
        expect(prisma.payment.update.mock.calls[0][0].data).toEqual({
            providerPaymentId: 'yk-1',
            confirmationUrl: 'https://yoomoney.ru/checkout/yk-1',
        })
        expect(out.confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-1')
        expect(out.payment.status).toBe('PENDING')
    })

    it('refuses a child profile (no e-mail for the receipt) before any payment row', async () => {
        const prisma = prismaFor()
        prisma.user.findUniqueOrThrow.mockResolvedValue({ email: null })
        const gateway = gatewayOk()
        await expect(run(prisma, gateway, 'kid')).rejects.toMatchObject({
            statusCode: 400,
        })
        expect(prisma.payment.create).not.toHaveBeenCalled()
        expect(gateway.createPayment).not.toHaveBeenCalled()
    })

    it('only offers purchasable plans of this club', async () => {
        const prisma = prismaFor({ plan: null })
        await expect(run(prisma)).rejects.toMatchObject({ statusCode: 404 })
        expect(prisma.plan.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'ws-1',
            isActive: true,
            purchasableOnline: true,
            isFreeTrial: false,
            price: { gt: 0 },
            id: 'plan-1',
        })
    })

    it('refuses the owner, a non-member, a disabled section and a club without a provider', async () => {
        await expect(run(prismaFor(), gatewayOk(), 'owner-1')).rejects.toMatchObject({
            statusCode: 400,
        })
        await expect(run(prismaFor({ member: null }))).rejects.toMatchObject({
            statusCode: 404,
        })
        await expect(
            run(prismaFor({ workspace: workspace({ subscriptionEnabled: false }) })),
        ).rejects.toMatchObject({ statusCode: 403 })
        await expect(run(prismaFor({ settings: null }))).rejects.toMatchObject({
            statusCode: 400,
        })
        await expect(run(prismaFor({ workspace: null }))).rejects.toMatchObject({
            statusCode: 404,
        })
    })

    it('refuses with MODULE_NOT_ENTITLED when ONLINE_PAYMENTS is not on the bill', async () => {
        const prisma = prismaFor({
            workspace: workspace({ billing: { status: 'ACTIVE' } }),
        })
        const gateway = gatewayOk()
        await expect(run(prisma, gateway)).rejects.toMatchObject({
            statusCode: 403,
            code: 'MODULE_NOT_ENTITLED',
        })
        expect(gateway.createPayment).not.toHaveBeenCalled()
        expect(prisma.payment.create).not.toHaveBeenCalled()
    })

    it('never charges for an abonement that could not be granted', async () => {
        const prisma = prismaFor({ member: liveClassPack })
        const gateway = gatewayOk()
        await expect(run(prisma, gateway)).rejects.toMatchObject({ statusCode: 400 })
        expect(gateway.createPayment).not.toHaveBeenCalled()
        expect(prisma.payment.create).not.toHaveBeenCalled()
    })

    it('lets a member buy a tariff of other directions next to a live pack', async () => {
        const bjjPack = {
            id: 'm-1',
            subscriptions: [
                { ...liveClassPack.subscriptions[0], directions: [{ directionId: 'bjj' }] },
            ],
        }
        const prisma = prismaFor({ member: bjjPack })
        const gateway = gatewayOk()
        await run(prisma, gateway)
        expect(gateway.createPayment).toHaveBeenCalled()

        const sameScope = prismaFor({
            member: bjjPack,
            plan: { ...plan, directions: [{ directionId: 'bjj' }] },
        })
        await expect(run(sameScope)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('reuses a recent pending payment for a repeated tap', async () => {
        const recent = paymentRow({
            providerPaymentId: 'yk-0',
            confirmationUrl: 'https://yoomoney.ru/checkout/yk-0',
        })
        const prisma = prismaFor({ recent })
        const gateway = gatewayOk()
        const out = await run(prisma, gateway)
        expect(out.confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-0')
        expect(gateway.createPayment).not.toHaveBeenCalled()
        expect(prisma.payment.create).not.toHaveBeenCalled()
    })

    it('cancels the row and answers a clean error when the provider refuses', async () => {
        const prisma = prismaFor()
        const gateway = {
            createPayment: jest
                .fn()
                .mockRejectedValue(new PaymentGatewayError('x', 401, 'bad key')),
        }
        await expect(run(prisma, gateway)).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('Не удалось создать платёж'),
        })
        expect(prisma.payment.update.mock.calls[0][0].data).toEqual({
            status: 'CANCELED',
            providerPaymentId: null,
        })
    })

    it('rethrows unexpected errors', async () => {
        const gateway = { createPayment: jest.fn().mockRejectedValue(new Error('bug')) }
        await expect(run(prismaFor(), gateway)).rejects.toThrow('bug')
    })
})

describe('getOnlinePurchaseOptions', () => {
    const run = (prisma: ReturnType<typeof prismaFor>, userId = 'u-1') =>
        new GetOnlinePurchaseOptionsHandler(prisma as never).execute(
            new GetOnlinePurchaseOptionsFeature('ws-1', userId),
        )

    it('lists purchasable plans with the provider', async () => {
        const out = await run(prismaFor())
        expect(out).toEqual({
            available: true,
            provider: 'YOOKASSA',
            plans: [{ ...plan, directions: [] }],
            blockedReason: null,
            renewalFrom: null,
            pendingPayment: null,
        })
    })

    it('is empty for the owner, a disabled section and a club without a provider', async () => {
        expect((await run(prismaFor(), 'owner-1')).available).toBe(false)
        expect(
            (await run(prismaFor({ workspace: workspace({ subscriptionEnabled: false }) })))
                .available,
        ).toBe(false)
        const noProvider = await run(prismaFor({ settings: null }))
        expect(noProvider).toMatchObject({ available: false, plans: [] })
        expect((await run(prismaFor({ plans: [] }))).available).toBe(false)
    })

    it('is empty when ONLINE_PAYMENTS is not on the bill', async () => {
        const out = await run(
            prismaFor({ workspace: workspace({ billing: { status: 'ACTIVE' } }) }),
        )
        expect(out).toMatchObject({ available: false, plans: [] })
    })

    it('explains why buying is blocked and shows the pending payment', async () => {
        const pending = paymentRow({ providerPaymentId: 'yk-1' })
        const out = await run(prismaFor({ member: liveClassPack, recent: pending }))
        expect(out.blockedReason).toContain('занятия')
        expect(out.pendingPayment).toMatchObject({ id: 'pay-1', status: 'PENDING' })
    })

    const bjj = { id: 'bjj', name: 'БЖЖ', color: null, icon: null }
    const muay = { id: 'muay', name: 'Тайский бокс', color: null, icon: null }
    const scoped = (id: string, d: typeof bjj | null) => ({
        ...plan,
        id,
        directions: d ? [{ directionId: d.id, direction: d }] : [],
    })

    it('offers tariffs of the member directions plus club-wide ones, with their directions', async () => {
        const plans = [scoped('club', null), scoped('p-bjj', bjj), scoped('p-muay', muay)]
        const out = await run(prismaFor({ plans, memberDirections: ['bjj'] }))
        expect(out.plans.map((p) => p.id)).toEqual(['club', 'p-bjj'])
        expect(out.plans[1].directions).toEqual([bjj])
    })

    it('offers every tariff to a member without directions', async () => {
        const plans = [scoped('club', null), scoped('p-bjj', bjj)]
        const out = await run(prismaFor({ plans }))
        expect(out.plans.map((p) => p.id)).toEqual(['club', 'p-bjj'])
    })

    it('does not block buying another direction over a live pack', async () => {
        const member = {
            id: 'm-1',
            subscriptions: [
                { ...liveClassPack.subscriptions[0], directions: [{ directionId: 'bjj' }] },
            ],
        }
        const both = await run(
            prismaFor({ member, plans: [scoped('p-bjj', bjj), scoped('p-muay', muay)] }),
        )
        expect(both.blockedReason).toBeNull()
        const onlyBjj = await run(prismaFor({ member, plans: [scoped('p-bjj', bjj)] }))
        expect(onlyBjj.blockedReason).toContain('занятия')
    })

    it('names the renewal day over a live time-only abonement', async () => {
        const out = await run(
            prismaFor({
                member: {
                    id: 'm-1',
                    subscriptions: [
                        {
                            status: 'ACTIVE',
                            startDate: new Date('2026-10-15T21:00:00Z'),
                            endDate: new Date('2099-03-09T21:00:00Z'),
                            classesTotal: null,
                            classesRemaining: null,
                            directions: [],
                        },
                    ],
                },
            }),
        )
        expect(out.renewalFrom).toBe('2099-03-10')
    })
})

describe('getMyPayment', () => {
    it('reads only the caller’s own payment in this club', async () => {
        const prisma = { payment: { findFirst: jest.fn().mockResolvedValue(paymentRow()) } }
        const out = await new GetMyPaymentHandler(prisma as never).execute(
            new GetMyPaymentFeature('ws-1', 'pay-1', 'u-1'),
        )
        expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({
            id: 'pay-1',
            workspaceId: 'ws-1',
            userId: 'u-1',
        })
        expect(out).toMatchObject({ id: 'pay-1', status: 'PENDING', paidAt: null })
    })

    it('404s on someone else’s payment', async () => {
        const prisma = { payment: { findFirst: jest.fn().mockResolvedValue(null) } }
        await expect(
            new GetMyPaymentHandler(prisma as never).execute(
                new GetMyPaymentFeature('ws-1', 'pay-1', 'u-2'),
            ),
        ).rejects.toMatchObject({ statusCode: 404 })
    })
})
