jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        rootUrl: 'https://api.example.com/',
        appUrl: 'https://app.example.com',
        billing: { enabled: true },
        memberAutopay: { enabled: true },
    },
}))

import { AUTOPAY_CONSENT_VERSION } from '../../domains/autopay/autopay-consent'
import { formatMoney } from '../../domains/analytics/money'
import { environment } from '../../environments/environment'
import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { CreatePaymentFeature } from './create-payment.feature'
import { CreatePaymentHandler } from './create-payment.handler'
import { GetCheckoutQuoteFeature } from './get-checkout-quote.feature'
import { GetCheckoutQuoteHandler } from './get-checkout-quote.handler'
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
    autopayEnabled: false,
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
    listPrice: 4500,
    discountId: null,
    discountName: null,
    discountAmount: 0,
    status: 'PENDING',
    idempotenceKey: 'idem-1',
    activationError: null,
    createdAt: new Date('2026-11-01T09:00:00Z'),
    updatedAt: new Date('2026-11-01T09:00:00Z'),
    paidAt: null,
    refundedAt: null,
    autopayId: null,
    autopayConsentVersion: null,
    payerUserId: null,
    ...over,
})

// A discount row as discountRuleSelect reads it.
const discount = (over: Record<string, unknown> = {}) => ({
    id: 'd-promo',
    name: 'Весна',
    kind: 'PERCENT',
    value: 10,
    currency: null,
    code: 'ВЕСНА',
    isFamily: false,
    allPlans: true,
    events: false,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    oncePerMember: false,
    isActive: true,
    plans: [],
    ...over,
})
const family = (value = 10) =>
    discount({ id: 'd-family', name: 'Семейная', code: null, isFamily: true, value })

const prismaFor = (opts: {
    workspace?: Record<string, unknown> | null
    member?: Record<string, unknown> | null
    settings?: Record<string, unknown> | null
    plan?: Record<string, unknown> | null
    plans?: Array<Record<string, unknown>>
    recent?: Record<string, unknown> | null
    // Directions the member trains in (their groups').
    memberDirections?: string[]
    // The club's active family discount, and whether a relative holds a
    // current abonement (the buyer qualifies).
    family?: Record<string, unknown> | null
    familyEligible?: boolean
    // Active discounts with a code.
    promos?: Array<Record<string, unknown>>
    // Uses of a discount (sales + open checkouts), per count call.
    uses?: number
    // The member's autopay agreements ({ planId, status }).
    autopays?: Array<{ planId: string; status: string }>
    // A renewal charge of the tariff still PENDING.
    charging?: Record<string, unknown> | null
    // E-mails by user id (anyone else: member@example.com).
    emails?: Record<string, string | null>
} = {}) => {
    const emailOf = (id: string) =>
        opts.emails && id in opts.emails ? opts.emails[id] : 'member@example.com'
    return {
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
        update: jest.fn().mockResolvedValue({}),
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
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({
            email: emailOf(where.id),
        })),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
            email: emailOf(where.id),
        })),
    },
    payment: {
        // The autopay in-flight check asks for a renewal key; anything else
        // is the checkout's reuse lookup, which matches the payer.
        findFirst: jest.fn(
            async (args: {
                where: { idempotenceKey?: { startsWith?: string }; payerUserId?: string | null }
            }) =>
                args.where.idempotenceKey?.startsWith
                    ? (opts.charging ?? null)
                    : opts.recent &&
                        (opts.recent.payerUserId ?? null) === (args.where.payerUserId ?? null)
                      ? opts.recent
                      : null,
        ),
        create: jest.fn(async ({ data }) => paymentRow(data)),
        update: jest.fn(async ({ data }) => paymentRow(data)),
        count: jest.fn().mockResolvedValue(0),
    },
    discount: {
        findFirst: jest.fn(async ({ where }: { where: { isFamily?: boolean; code?: string } }) =>
            where.isFamily
                ? (opts.family ?? null)
                : ((opts.promos ?? []).find((d) => d.code === where.code) ?? null),
        ),
    },
    guardianship: {
        findMany: jest
            .fn()
            .mockResolvedValue(
                opts.familyEligible ? [{ guardianId: 'parent-1', dependentId: 'u-1' }] : [],
            ),
    },
    subscription: {
        findFirst: jest.fn().mockResolvedValue(opts.familyEligible ? { id: 'sibling-sub' } : null),
        count: jest.fn().mockResolvedValue(opts.uses ?? 0),
    },
    eventRegistration: { count: jest.fn().mockResolvedValue(0) },
    memberAutopay: {
        findMany: jest.fn(async ({ where }: { where: { status?: string } }) =>
            (opts.autopays ?? []).filter((a) => !where.status || a.status === where.status),
        ),
        findFirst: jest.fn(
            async ({ where }: { where: { planId?: string; status?: string } }) =>
                (opts.autopays ?? []).find(
                    (a) => a.planId === where.planId && a.status === where.status,
                ) ?? null,
        ),
    },
    }
}

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
        promoCode?: string,
        actorUserId = userId,
    ) =>
        new CreatePaymentHandler(prisma as never, gateway as never, {} as never).execute(
            new CreatePaymentFeature({ planId: 'plan-1', promoCode }, 'ws-1', userId, actorUserId),
        )

    it('charges the promo price and stores the price facts on the payment', async () => {
        const prisma = prismaFor({ promos: [discount()] })
        const gateway = gatewayOk()
        await run(prisma, gateway, 'u-1', ' весна ')
        expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
            amount: 4050,
            listPrice: 4500,
            discountId: 'd-promo',
            discountName: 'Весна',
            discountAmount: 450,
        })
        expect(gateway.createPayment.mock.calls[0][1]).toMatchObject({ amount: 4050 })
    })

    it('charges the family price by itself; a tie with a code goes to family', async () => {
        const prisma = prismaFor({ family: family(10), familyEligible: true, promos: [discount()] })
        await run(prisma, gatewayOk(), 'u-1', 'ВЕСНА')
        expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
            amount: 4050,
            discountId: 'd-family',
            discountName: 'Семейная',
        })
        const bigger = prismaFor({
            family: family(10),
            familyEligible: true,
            promos: [discount({ value: 20 })],
        })
        await run(bigger, gatewayOk(), 'u-1', 'ВЕСНА')
        expect(bigger.payment.create.mock.calls[0][0].data).toMatchObject({
            amount: 3600,
            discountId: 'd-promo',
        })
    })

    it('refuses a code it cannot apply, never charging another price', async () => {
        const cases: Array<[ReturnType<typeof prismaFor>, string, string]> = [
            [prismaFor(), 'НЕТТАКОГО', 'Промокод не найден'],
            [prismaFor(), '!!', 'Промокод не найден'],
            [
                prismaFor({ promos: [discount({ endsOn: new Date('2020-01-01T00:00:00Z') })] }),
                'ВЕСНА',
                'Срок действия промокода закончился',
            ],
            [
                prismaFor({ promos: [discount({ allPlans: false, plans: [{ planId: 'other' }] })] }),
                'ВЕСНА',
                'Промокод не действует на этот тариф',
            ],
            [
                prismaFor({ promos: [discount({ oncePerMember: true })], uses: 1 }),
                'ВЕСНА',
                'Вы уже использовали этот промокод',
            ],
            [
                prismaFor({ promos: [discount({ maxUses: 3 })], uses: 3 }),
                'ВЕСНА',
                'Промокоды по этой акции закончились',
            ],
            [
                prismaFor({ promos: [discount({ value: 100 })] }),
                'ВЕСНА',
                'С промокодом выходит 0 ₽ — оформите покупку в клубе',
            ],
        ]
        for (const [prisma, code, message] of cases) {
            const gateway = gatewayOk()
            await expect(run(prisma, gateway, 'u-1', code)).rejects.toMatchObject({
                statusCode: 400,
                message,
            })
            expect(prisma.payment.create).not.toHaveBeenCalled()
            expect(gateway.createPayment).not.toHaveBeenCalled()
        }
    })

    it('counts open checkouts against a code, except the member’s own reused one', async () => {
        const recent = paymentRow({
            id: 'pay-0',
            providerPaymentId: 'yk-0',
            confirmationUrl: 'https://yoomoney.ru/checkout/yk-0',
            amount: 4050,
            discountId: 'd-promo',
        })
        const prisma = prismaFor({ promos: [discount({ oncePerMember: true })], recent })
        const out = await run(prisma, gatewayOk(), 'u-1', 'ВЕСНА')
        expect(out.confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-0')
        expect(prisma.payment.count.mock.calls[0][0].where).toMatchObject({
            discountId: 'd-promo',
            status: 'PENDING',
            userId: 'u-1',
            NOT: { id: 'pay-0' },
        })
    })

    it('makes a new payment when the price changed since the pending one', async () => {
        const recent = paymentRow({
            providerPaymentId: 'yk-0',
            confirmationUrl: 'https://yoomoney.ru/checkout/yk-0',
        })
        const prisma = prismaFor({ recent, promos: [discount()] })
        const gateway = gatewayOk()
        const out = await run(prisma, gateway, 'u-1', 'ВЕСНА')
        expect(out.confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-1')
        expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({ amount: 4050 })
    })

    it('creates the provider payment and returns its confirmation URL', async () => {
        const prisma = prismaFor()
        const gateway = gatewayOk()
        const out = await run(prisma, gateway)
        const created = prisma.payment.create.mock.calls[0][0].data
        expect(created).toMatchObject({
            workspaceId: 'ws-1',
            userId: 'u-1',
            payerUserId: null,
            planId: 'plan-1',
            planName: 'Безлимит',
            provider: 'YOOKASSA',
            amount: 4500,
            currency: 'RUB',
            receiptEmail: 'member@example.com',
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

    it('a guardian buys for a child: the child holds it, the guardian pays and gets the receipt', async () => {
        const prisma = prismaFor({ emails: { kid: null, 'parent-1': 'parent@example.com' } })
        const gateway = gatewayOk()
        await run(prisma, gateway, 'kid', undefined, 'parent-1')
        expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
            userId: 'kid',
            payerUserId: 'parent-1',
            receiptEmail: 'parent@example.com',
        })
        expect(gateway.createPayment.mock.calls[0][1]).toMatchObject({
            customerEmail: 'parent@example.com',
            // No child's name goes to the provider.
            description: 'Абонемент «Безлимит» — Клуб',
            itemName: 'Абонемент «Безлимит»',
        })
        // The child's price (family discount, promo limits) — the holder's.
        const reuse = prisma.payment.findFirst.mock.calls.find(([a]) => !a.where.idempotenceKey)
        expect(reuse?.[0].where).toMatchObject({ userId: 'kid', payerUserId: 'parent-1' })
    })

    it('reuses the same parent’s pending payment and ignores the other parent’s', async () => {
        const pending = (payerUserId: string) =>
            paymentRow({
                userId: 'kid',
                payerUserId,
                providerPaymentId: 'yk-0',
                confirmationUrl: 'https://yoomoney.ru/checkout/yk-0',
            })
        const emails = { kid: null, 'parent-1': 'mom@example.com', 'parent-2': 'dad@example.com' }
        const same = prismaFor({ recent: pending('parent-1'), emails })
        const sameGateway = gatewayOk()
        const reused = await run(same, sameGateway, 'kid', undefined, 'parent-1')
        expect(reused.confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-0')
        expect(sameGateway.createPayment).not.toHaveBeenCalled()

        const other = prismaFor({ recent: pending('parent-1'), emails })
        const otherGateway = gatewayOk()
        const own = await run(other, otherGateway, 'kid', undefined, 'parent-2')
        expect(own.confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-1')
        expect(other.payment.create.mock.calls[0][0].data).toMatchObject({
            payerUserId: 'parent-2',
            receiptEmail: 'dad@example.com',
        })
        expect(otherGateway.createPayment.mock.calls[0][1].customerEmail).toBe('dad@example.com')
    })

    it('refuses when neither the child nor the guardian has an e-mail, before any payment row', async () => {
        const prisma = prismaFor({ emails: { kid: null, 'parent-1': null } })
        const gateway = gatewayOk()
        await expect(run(prisma, gateway, 'kid', undefined, 'parent-1')).rejects.toMatchObject({
            statusCode: 400,
            message: 'Для онлайн-оплаты нужен e-mail в профиле — на него придёт чек',
        })
        expect(prisma.payment.create).not.toHaveBeenCalled()
        expect(gateway.createPayment).not.toHaveBeenCalled()
    })

    it('refuses an adult without an e-mail', async () => {
        const prisma = prismaFor({ emails: { 'u-1': null } })
        await expect(run(prisma)).rejects.toMatchObject({ statusCode: 400 })
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
        expect(prisma.payment.create).not.toHaveBeenCalled()
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

    describe('with «Продлевать автоматически»', () => {
        const autopayClub = { ...settings, autopayEnabled: true }
        const renewable = { ...plan, autopayAvailable: true }
        const notices = () => ({ staffAlert: jest.fn().mockResolvedValue(undefined) })
        const buy = (
            prisma: ReturnType<typeof prismaFor>,
            gateway = gatewayOk(),
            payload: {
                autopay?: boolean
                autopayConsentVersion?: string
                autopayRenewalAmount?: number
            } = {
                autopay: true,
                autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
                autopayRenewalAmount: 4500,
            },
            n = notices(),
            holder = { userId: 'u-1', actorUserId: 'u-1' },
        ) =>
            new CreatePaymentHandler(prisma as never, gateway as never, n as never).execute(
                new CreatePaymentFeature(
                    { planId: 'plan-1', autopay: false, ...payload },
                    'ws-1',
                    holder.userId,
                    holder.actorUserId,
                ),
            )
        afterEach(() => {
            ;(environment as { memberAutopay: { enabled: boolean } }).memberAutopay.enabled = true
        })

        it('records the consent version and asks YooKassa to save the card', async () => {
            const prisma = prismaFor({ settings: autopayClub, plan: renewable })
            const gateway = gatewayOk()
            const out = await buy(prisma, gateway)
            expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
                autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
            })
            expect(gateway.createPayment.mock.calls[0][1]).toMatchObject({ savePaymentMethod: true })
            expect(out.payment.autopay).toBeNull()
        })

        it('refuses autopay for a child (a guardian acting) before any check or gateway call', async () => {
            const prisma = prismaFor({
                settings: autopayClub,
                plan: renewable,
                emails: { kid: null, 'parent-1': 'parent@example.com' },
            })
            const gateway = gatewayOk()
            await expect(
                buy(prisma, gateway, undefined, undefined, { userId: 'kid', actorUserId: 'parent-1' }),
            ).rejects.toMatchObject({
                statusCode: 400,
                message: 'Автоплатёж для абонемента ребёнка не подключается — продлевайте его покупкой',
            })
            expect(prisma.memberAutopay.findFirst).not.toHaveBeenCalled()
            expect(prisma.payment.create).not.toHaveBeenCalled()
            expect(gateway.createPayment).not.toHaveBeenCalled()
        })

        it('refuses where autopay is not offered, on stale terms and over an ACTIVE agreement', async () => {
            const cases: Array<[ReturnType<typeof prismaFor>, string, Record<string, unknown>?]> = [
                [
                    prismaFor({ settings: { ...autopayClub, provider: 'STRIPE' }, plan: renewable }),
                    'Автоплатёж для этого тарифа недоступен',
                ],
                [prismaFor({ settings, plan: renewable }), 'Автоплатёж для этого тарифа недоступен'],
                [prismaFor({ settings: autopayClub, plan }), 'Автоплатёж для этого тарифа недоступен'],
                [
                    prismaFor({ settings: autopayClub, plan: renewable }),
                    'Условия автоплатежа обновились — обновите экран',
                    { autopay: true, autopayConsentVersion: '2020-01-01', autopayRenewalAmount: 4500 },
                ],
                [
                    prismaFor({
                        settings: autopayClub,
                        plan: renewable,
                        autopays: [{ planId: 'plan-1', status: 'ACTIVE' }],
                    }),
                    'Автоплатёж по этому тарифу уже включён',
                ],
            ]
            for (const [prisma, message, payload] of cases) {
                const gateway = gatewayOk()
                await expect(buy(prisma, gateway, payload)).rejects.toMatchObject({
                    statusCode: 400,
                    message,
                })
                expect(prisma.payment.create).not.toHaveBeenCalled()
                expect(gateway.createPayment).not.toHaveBeenCalled()
            }
        })

        it('refuses while the global switch is off', async () => {
            ;(environment as { memberAutopay: { enabled: boolean } }).memberAutopay.enabled = false
            await expect(
                buy(prismaFor({ settings: autopayClub, plan: renewable })),
            ).rejects.toMatchObject({ statusCode: 400, message: 'Автоплатёж для этого тарифа недоступен' })
        })

        it('lets a NEEDS_ACTION agreement be re-armed by paying with the switch on', async () => {
            const prisma = prismaFor({
                settings: autopayClub,
                plan: renewable,
                autopays: [{ planId: 'plan-1', status: 'NEEDS_ACTION' }],
            })
            const gateway = gatewayOk()
            await buy(prisma, gateway)
            expect(gateway.createPayment).toHaveBeenCalled()
        })

        it('reuses a pending payment only for the same choice and renewal amount', async () => {
            const reuseWhere = (p: ReturnType<typeof prismaFor>) =>
                p.payment.findFirst.mock.calls
                    .map((c) => c[0].where)
                    .find((w: Record<string, unknown>) => 'autopayConsentVersion' in w)
            const prisma = prismaFor({ settings: autopayClub, plan: renewable })
            await buy(prisma)
            expect(reuseWhere(prisma)).toMatchObject({
                autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
                autopayRenewalAmount: 4500,
            })
            const oneOff = prismaFor({ settings: autopayClub, plan: renewable })
            await buy(oneOff, gatewayOk(), {})
            expect(reuseWhere(oneOff)).toMatchObject({
                autopayConsentVersion: null,
                autopayRenewalAmount: null,
            })
        })

        it('stores the renewal amount the consent showed and the shop; 409 when it changed', async () => {
            const prisma = prismaFor({ settings: autopayClub, plan: renewable })
            await buy(prisma)
            expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
                autopayRenewalAmount: 4500,
                autopayShopId: '123456',
            })
            const changed = prismaFor({ settings: autopayClub, plan: renewable, family: family(10), familyEligible: true })
            await expect(buy(changed)).rejects.toMatchObject({
                statusCode: 409,
                message: 'Сумма продления изменилась — обновите экран',
            })
            expect(changed.payment.create).not.toHaveBeenCalled()
        })

        it('refuses a checkout while the tariff’s autopay charge is at the provider', async () => {
            const prisma = prismaFor({ settings: autopayClub, plan: renewable, charging: { id: 'pay-a' } })
            await expect(buy(prisma, gatewayOk(), {})).rejects.toMatchObject({
                statusCode: 400,
                message: 'Автоплатёж по этому тарифу сейчас списывается — подождите несколько минут',
            })
        })

        it('sends save_payment_method false on a one-off payment in an autopay club, omits it elsewhere', async () => {
            const inClub = gatewayOk()
            await buy(prismaFor({ settings: autopayClub, plan: renewable }), inClub, {})
            expect(inClub.createPayment.mock.calls[0][1].savePaymentMethod).toBe(false)
            const plain = gatewayOk()
            await buy(prismaFor(), plain, {})
            expect(plain.createPayment.mock.calls[0][1].savePaymentMethod).toBeUndefined()
            const stripe = gatewayOk()
            await buy(
                prismaFor({ settings: { ...autopayClub, provider: 'STRIPE' } }),
                stripe,
                {},
            )
            expect(stripe.createPayment.mock.calls[0][1].savePaymentMethod).toBeUndefined()
        })

        it('records a YooKassa refusal of the setup, alerts the admins and answers 400', async () => {
            const prisma = prismaFor({ settings: autopayClub, plan: renewable })
            const gateway = {
                createPayment: jest
                    .fn()
                    .mockRejectedValue(
                        new PaymentGatewayError('x', 403, 'Recurring payments are not enabled'),
                    ),
            }
            const n = notices()
            await expect(buy(prisma, gateway, undefined, n)).rejects.toMatchObject({
                statusCode: 400,
                message: 'Не удалось подключить автоплатёж — оплатите без него или обратитесь в клуб',
            })
            expect(prisma.workspacePaymentSettings.update.mock.calls[0][0]).toMatchObject({
                where: { workspaceId: 'ws-1' },
                data: { autopayLastError: 'Recurring payments are not enabled' },
            })
            expect(n.staffAlert.mock.calls[0][0]).toMatchObject({
                workspaceId: 'ws-1',
                message: expect.stringContaining('ЮKassa отказала в подключении автоплатежа'),
            })
        })

        it('treats a provider outage on a setup as an ordinary failure', async () => {
            const prisma = prismaFor({ settings: autopayClub, plan: renewable })
            const gateway = {
                createPayment: jest.fn().mockRejectedValue(new PaymentGatewayError('x', 503, null)),
            }
            await expect(buy(prisma, gateway)).rejects.toMatchObject({
                message: expect.stringContaining('Не удалось создать платёж'),
            })
            expect(prisma.workspacePaymentSettings.update).not.toHaveBeenCalled()
        })
    })
})

describe('getOnlinePurchaseOptions', () => {
    const run = (prisma: ReturnType<typeof prismaFor>, userId = 'u-1', actorUserId = userId) =>
        new GetOnlinePurchaseOptionsHandler(prisma as never).execute(
            new GetOnlinePurchaseOptionsFeature('ws-1', userId, actorUserId),
        )

    it('lists purchasable plans with the provider', async () => {
        const out = await run(prismaFor())
        expect(out).toEqual({
            available: true,
            provider: 'YOOKASSA',
            blockedReason: null,
            renewalFrom: null,
            pendingPayment: null,
            autopayTermsUrl: null,
            plans: [{ ...plan, amount: 4500, discountName: null, directions: [], autopay: null }],
        })
    })

    it('prices each card with the family discount when the member qualifies', async () => {
        const out = await run(prismaFor({ family: family(10), familyEligible: true }))
        expect(out.plans[0]).toMatchObject({ price: 4500, amount: 4050, discountName: 'Семейная' })
        const notEligible = await run(prismaFor({ family: family(10), familyEligible: false }))
        expect(notEligible.plans[0]).toMatchObject({ amount: 4500, discountName: null })
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

    describe('autopay offer', () => {
        const autopayClub = { ...settings, autopayEnabled: true }
        const renewable = { ...plan, autopayAvailable: true }
        afterEach(() => {
            ;(environment as { memberAutopay: { enabled: boolean } }).memberAutopay.enabled = true
        })

        it('offers the switch with the consent and the terms page where club and tariff allow it', async () => {
            const out = await run(
                prismaFor({ settings: autopayClub, plans: [renewable], family: family(10), familyEligible: true }),
            )
            expect(out.plans[0].autopay).toEqual({
                renewalAmount: 4050,
                consentVersion: AUTOPAY_CONSENT_VERSION,
                consentLines: expect.arrayContaining([
                    `Сейчас спишем ${formatMoney(4050, 'RUB')}.`,
                    `Дальше клуб «Клуб» будет списывать ${formatMoney(4050, 'RUB')} с этой карты за каждый следующий абонемент «Безлимит»: за день до окончания срока.`,
                    'За 3 дня до списания пришлём напоминание.',
                ]),
            })
            expect(out.plans[0]).not.toHaveProperty('autopayAvailable')
            expect(out.autopayTermsUrl).toBe('https://app.example.com/legal/autopay')
        })

        it('is null in a child’s profile, and the pending payment is the guardian’s own', async () => {
            const prisma = prismaFor({ settings: autopayClub, plans: [renewable] })
            const out = await run(prisma, 'kid', 'parent-1')
            expect(out.available).toBe(true)
            expect(out.plans[0].autopay).toBeNull()
            expect(out.autopayTermsUrl).toBeNull()
            expect(prisma.memberAutopay.findMany).not.toHaveBeenCalled()
            expect(prisma.payment.findFirst.mock.calls[0][0].where).toMatchObject({
                userId: 'kid',
                payerUserId: 'parent-1',
            })
        })

        it('words a pack’s timing by classes or term', async () => {
            const out = await run(
                prismaFor({ settings: autopayClub, plans: [{ ...renewable, classCount: 12 }] }),
            )
            expect(out.plans[0].autopay?.consentLines[1]).toContain(
                'когда закончатся занятия или срок',
            )
        })

        it('is null with an ACTIVE agreement, a tariff or club without it, Stripe, or the switch off', async () => {
            const active = await run(
                prismaFor({
                    settings: autopayClub,
                    plans: [renewable],
                    autopays: [{ planId: 'plan-1', status: 'ACTIVE' }],
                }),
            )
            expect(active.plans[0].autopay).toBeNull()
            expect(active.autopayTermsUrl).toBeNull()
            const needsAction = await run(
                prismaFor({
                    settings: autopayClub,
                    plans: [renewable],
                    autopays: [{ planId: 'plan-1', status: 'NEEDS_ACTION' }],
                }),
            )
            expect(needsAction.plans[0].autopay).not.toBeNull()
            expect((await run(prismaFor({ settings: autopayClub }))).plans[0].autopay).toBeNull()
            expect((await run(prismaFor({ plans: [renewable] }))).plans[0].autopay).toBeNull()
            const stripe = await run(
                prismaFor({ settings: { ...autopayClub, provider: 'STRIPE' }, plans: [renewable] }),
            )
            expect(stripe.plans[0].autopay).toBeNull()
            ;(environment as { memberAutopay: { enabled: boolean } }).memberAutopay.enabled = false
            const off = await run(prismaFor({ settings: autopayClub, plans: [renewable] }))
            expect(off.plans[0].autopay).toBeNull()
            expect(off.autopayTermsUrl).toBeNull()
        })
    })
})

describe('getCheckoutQuote', () => {
    const quote = (
        prisma: ReturnType<typeof prismaFor> & { eventRegistration?: Record<string, jest.Mock> },
        payload: { planId?: string; registrationId?: string; promoCode?: string },
        userId = 'u-1',
        actorUserId = userId,
    ) =>
        new GetCheckoutQuoteHandler(prisma as never).execute(
            new GetCheckoutQuoteFeature(payload, 'ws-1', userId, actorUserId),
        )

    it('quotes a tariff with a code, and answers every refusal as a note', async () => {
        const ok = await quote(prismaFor({ promos: [discount({ endsOn: new Date('2099-03-31T00:00:00Z') })] }), {
            planId: 'plan-1',
            promoCode: 'весна',
        })
        expect(ok).toEqual({
            listPrice: 4500,
            amount: 4050,
            currency: 'RUB',
            discount: { name: 'Весна', code: 'ВЕСНА', isFamily: false, endsOn: '2099-03-31' },
            promoCodeNote: null,
            autopay: null,
        })
        const unknown = await quote(prismaFor(), { planId: 'plan-1', promoCode: 'ЛЕТО' })
        expect(unknown).toMatchObject({ amount: 4500, discount: null, promoCodeNote: 'Промокод не найден' })
        const used = await quote(prismaFor({ promos: [discount({ oncePerMember: true })], uses: 1 }), {
            planId: 'plan-1',
            promoCode: 'ВЕСНА',
        })
        expect(used.promoCodeNote).toBe('Вы уже использовали этот промокод')
    })

    it('keeps the family price when it saves more, with the note', async () => {
        const out = await quote(
            prismaFor({ family: family(20), familyEligible: true, promos: [discount()] }),
            { planId: 'plan-1', promoCode: 'ВЕСНА' },
        )
        expect(out).toMatchObject({
            amount: 3600,
            discount: { name: 'Семейная', isFamily: true, code: null },
            promoCodeNote: 'Семейная скидка выгоднее — она уже учтена',
        })
    })

    it('refuses what the checkout refuses: the owner, a non-member, a tariff not sold online', async () => {
        await expect(quote(prismaFor(), { planId: 'plan-1' }, 'owner-1')).rejects.toMatchObject({ statusCode: 400 })
        await expect(quote(prismaFor({ member: null }), { planId: 'plan-1' })).rejects.toMatchObject({
            statusCode: 404,
        })
        await expect(quote(prismaFor({ plan: null }), { planId: 'plan-1' })).rejects.toMatchObject({
            statusCode: 404,
        })
        await expect(
            quote(prismaFor({ workspace: workspace({ subscriptionEnabled: false }) }), { planId: 'plan-1' }),
        ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('quotes the member’s own ticket of a paid event; a free one or someone else’s is refused', async () => {
        const withTicket = (event: Record<string, unknown> | null) => {
            const prisma = prismaFor({ promos: [discount({ events: true })] })
            return Object.assign(prisma, {
                eventRegistration: {
                    ...prisma.eventRegistration,
                    findFirst: jest.fn().mockResolvedValue(
                        event && { id: 'reg-1', event, workspace: { timezone: 'Europe/Moscow' } },
                    ),
                },
            })
        }
        const prisma = withTicket({ id: 'ev-1', price: 1500, currency: 'RUB' })
        const out = await quote(prisma, { registrationId: 'reg-1', promoCode: 'ВЕСНА' })
        expect(out).toMatchObject({ listPrice: 1500, amount: 1350, discount: { name: 'Весна' } })
        expect(prisma.eventRegistration.findFirst.mock.calls[0][0].where).toEqual({
            id: 'reg-1',
            workspaceId: 'ws-1',
            userId: 'u-1',
        })
        await expect(
            quote(withTicket({ id: 'ev-1', price: 0, currency: 'RUB' }), { registrationId: 'reg-1' }),
        ).rejects.toMatchObject({ statusCode: 400 })
        await expect(quote(withTicket(null), { registrationId: 'reg-1' })).rejects.toMatchObject({
            statusCode: 404,
        })
    })

    it('carries the autopay offer at the quoted price: «сейчас» with the code, «дальше» without', async () => {
        const out = await quote(
            prismaFor({
                settings: { ...settings, autopayEnabled: true },
                plan: { ...plan, autopayAvailable: true },
                promos: [discount()],
            }),
            { planId: 'plan-1', promoCode: 'ВЕСНА' },
        )
        expect(out.autopay).toMatchObject({
            renewalAmount: 4500,
            consentVersion: AUTOPAY_CONSENT_VERSION,
        })
        expect(out.autopay?.consentLines[0]).toBe(`Сейчас спишем ${formatMoney(4050, 'RUB')}.`)
        expect(out.autopay?.consentLines[1]).toContain(formatMoney(4500, 'RUB'))
        const active = await quote(
            prismaFor({
                settings: { ...settings, autopayEnabled: true },
                plan: { ...plan, autopayAvailable: true },
                autopays: [{ planId: 'plan-1', status: 'ACTIVE' }],
            }),
            { planId: 'plan-1' },
        )
        expect(active.autopay).toBeNull()
    })

    it('offers no autopay in a child’s profile; the price is still the child’s', async () => {
        const prisma = prismaFor({
            settings: { ...settings, autopayEnabled: true },
            plan: { ...plan, autopayAvailable: true },
            family: family(10),
            familyEligible: true,
        })
        prisma.guardianship.findMany.mockResolvedValue([{ guardianId: 'parent-1', dependentId: 'kid' }])
        const out = await quote(prisma, { planId: 'plan-1' }, 'kid', 'parent-1')
        expect(out.autopay).toBeNull()
        expect(out.amount).toBe(4050)
        expect(prisma.memberAutopay.findFirst).not.toHaveBeenCalled()
        expect(prisma.payment.findFirst.mock.calls[0][0].where).toMatchObject({
            userId: 'kid',
            payerUserId: 'parent-1',
        })
    })
})

describe('getMyPayment', () => {
    it('reads the holder’s or the payer’s payment in this club', async () => {
        const prisma = { payment: { findFirst: jest.fn().mockResolvedValue(paymentRow()) } }
        const out = await new GetMyPaymentHandler(prisma as never).execute(
            new GetMyPaymentFeature('ws-1', 'pay-1', 'u-1'),
        )
        expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({
            id: 'pay-1',
            workspaceId: 'ws-1',
            OR: [{ userId: 'u-1' }, { payerUserId: 'u-1' }],
        })
        expect(out).toMatchObject({ id: 'pay-1', status: 'PENDING', paidAt: null })
    })

    it('lets the guardian who paid follow the child’s payment from their own profile', async () => {
        const row = paymentRow({ userId: 'kid', payerUserId: 'parent-1' })
        const prisma = {
            payment: {
                findFirst: jest.fn(
                    async ({ where }: { where: { OR: Array<Record<string, string>> } }) =>
                        where.OR.some((c) => c.userId === row.userId || c.payerUserId === row.payerUserId)
                            ? row
                            : null,
                ),
            },
        }
        const handler = new GetMyPaymentHandler(prisma as never)
        await expect(
            handler.execute(new GetMyPaymentFeature('ws-1', 'pay-1', 'parent-1')),
        ).resolves.toMatchObject({ id: 'pay-1' })
        await expect(
            handler.execute(new GetMyPaymentFeature('ws-1', 'pay-1', 'stranger')),
        ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('404s on someone else’s payment', async () => {
        const prisma = { payment: { findFirst: jest.fn().mockResolvedValue(null) } }
        await expect(
            new GetMyPaymentHandler(prisma as never).execute(
                new GetMyPaymentFeature('ws-1', 'pay-1', 'u-2'),
            ),
        ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('says whether a granted autopay checkout set the agreement up', async () => {
        const read = (over: Record<string, unknown>) =>
            new GetMyPaymentHandler({
                payment: { findFirst: jest.fn().mockResolvedValue(paymentRow(over)) },
            } as never).execute(new GetMyPaymentFeature('ws-1', 'pay-1', 'u-1'))
        const granted = {
            status: 'SUCCEEDED',
            paidAt: new Date(),
            subscriptionId: 'sub-1',
            autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
        }
        expect((await read({ ...granted, autopayId: 'ap-1' })).autopay).toBe('on')
        expect((await read(granted)).autopay).toBe('not_saved')
        expect((await read({ ...granted, subscriptionId: null })).autopay).toBeNull()
        expect((await read({ ...granted, autopayConsentVersion: null })).autopay).toBeNull()
    })
})
