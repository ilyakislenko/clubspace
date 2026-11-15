jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        appUrl: 'https://app.example.com',
        billing: { enabled: true },
    },
}))

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { PayEventRegistrationOnlineFeature } from './pay-event-registration-online.feature'
import { PayEventRegistrationOnlineHandler } from './pay-event-registration-online.handler'

const settings = {
    workspaceId: 'ws-1',
    provider: 'YOOKASSA',
    shopId: '123456',
    secretKeyEncrypted: encryptPaymentSecret('live_key_1234', 'unit-test-encryption-key'),
    webhookSecretEncrypted: null,
    receiptEnabled: true,
    vatCode: 1,
    paymentSubject: 'service',
    paymentMode: 'full_prepayment',
}
const registration = (over: Record<string, unknown> = {}) => ({
    id: 'reg-1',
    status: 'BOOKED',
    isPaid: false,
    event: { id: 'ev-1', title: 'Семинар', price: 1500, currency: 'RUB' },
    ...over,
})
const promo = (over: Record<string, unknown> = {}) => ({
    id: 'd-1',
    name: 'Весна',
    kind: 'PERCENT',
    value: 10,
    currency: null,
    code: 'ВЕСНА',
    isFamily: false,
    allPlans: true,
    events: true,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    oncePerMember: false,
    isActive: true,
    plans: [],
    ...over,
})
const paymentRow = (data: Record<string, unknown>) => ({
    id: 'pay-1',
    status: 'PENDING',
    idempotenceKey: 'idem-1',
    providerPaymentId: null,
    confirmationUrl: null,
    subscriptionId: null,
    activationError: null,
    createdAt: new Date('2026-11-01T09:00:00Z'),
    paidAt: null,
    refundedAt: null,
    ...data,
})

const setup = (o: { registration?: Record<string, unknown> | null; promos?: Array<Record<string, unknown>>; recent?: Record<string, unknown> | null } = {}) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Клуб', timezone: 'Europe/Moscow', billing: null, moduleEntitlements: [] }),
    },
    workspacePaymentSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
    eventRegistration: {
        findFirst: jest.fn().mockResolvedValue(o.registration === undefined ? registration() : o.registration),
        count: jest.fn().mockResolvedValue(0),
    },
    payment: {
        findFirst: jest.fn().mockResolvedValue(o.recent ?? null),
        create: jest.fn(async ({ data }) => paymentRow(data)),
        update: jest.fn(async ({ data }) => paymentRow(data)),
        count: jest.fn().mockResolvedValue(0),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-1', email: 'member@example.com' }]) },
    discount: {
        findFirst: jest.fn(async ({ where }: { where: { isFamily?: boolean; code?: string } }) =>
            where.isFamily ? null : ((o.promos ?? []).find((d) => d.code === where.code) ?? null),
        ),
    },
    guardianship: { findMany: jest.fn().mockResolvedValue([]) },
    subscription: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
})

const gateway = () => ({
    createPayment: jest.fn().mockResolvedValue({
        providerPaymentId: 'yk-1',
        status: 'PENDING',
        confirmationUrl: 'https://yoomoney.ru/checkout/yk-1',
        amountMinor: 135000,
        currency: 'RUB',
    }),
})

const run = (prisma: ReturnType<typeof setup>, promoCode?: string, gw = gateway()) =>
    new PayEventRegistrationOnlineHandler(prisma as never, gw as never).execute(
        new PayEventRegistrationOnlineFeature({ promoCode }, 'ws-1', 'reg-1', 'u-1', 'u-1'),
    )

describe('payEventRegistrationOnline', () => {
    it('charges the event price without a code', async () => {
        const prisma = setup()
        await run(prisma)
        expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
            eventRegistrationId: 'reg-1',
            amount: 1500,
            listPrice: 1500,
            discountId: null,
            discountAmount: 0,
        })
    })

    it('charges the promo price when the code covers events, with the price facts', async () => {
        const prisma = setup({ promos: [promo()] })
        const gw = gateway()
        await run(prisma, 'весна', gw)
        expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
            amount: 1350,
            listPrice: 1500,
            discountId: 'd-1',
            discountName: 'Весна',
            discountAmount: 150,
        })
        expect(gw.createPayment.mock.calls[0][1]).toMatchObject({ amount: 1350, itemName: 'Билет «Семинар»' })
    })

    it('refuses a code that does not cover events, before any payment row', async () => {
        const prisma = setup({ promos: [promo({ events: false })] })
        const gw = gateway()
        await expect(run(prisma, 'ВЕСНА', gw)).rejects.toMatchObject({
            statusCode: 400,
            message: 'Промокод не действует на это событие',
        })
        expect(prisma.payment.create).not.toHaveBeenCalled()
        expect(gw.createPayment).not.toHaveBeenCalled()
    })

    it('reuses the pending payment only at the same price', async () => {
        const recent = paymentRow({
            id: 'pay-0',
            confirmationUrl: 'https://yoomoney.ru/checkout/yk-0',
            amount: 1500,
            discountId: null,
        })
        const same = setup({ recent })
        expect((await run(same)).confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-0')
        expect(same.payment.create).not.toHaveBeenCalled()
        const withCode = setup({ recent, promos: [promo()] })
        expect((await run(withCode, 'ВЕСНА')).confirmationUrl).toBe('https://yoomoney.ru/checkout/yk-1')
    })

    it('refuses a missing registration, a free event and a paid ticket', async () => {
        await expect(run(setup({ registration: null }))).rejects.toMatchObject({ statusCode: 404 })
        await expect(
            run(setup({ registration: registration({ event: { id: 'ev-1', title: 'X', price: 0, currency: 'RUB' } }) })),
        ).rejects.toMatchObject({ statusCode: 400 })
        await expect(run(setup({ registration: registration({ isPaid: true }) }))).rejects.toMatchObject({
            statusCode: 400,
        })
    })
})
