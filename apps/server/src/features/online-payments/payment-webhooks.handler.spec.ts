jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        rootUrl: 'https://api.example.com/',
        appUrl: 'https://app.example.com',
    },
}))

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { signStripePayload } from '../../domains/payments/stripe-signature'
import {
    HandleStripeWebhookFeature,
    HandleYookassaWebhookFeature,
} from './handle-payment-webhook.feature'
import { HandleStripeWebhookHandler } from './handle-stripe-webhook.handler'
import { HandleYookassaWebhookHandler } from './handle-yookassa-webhook.handler'

const KEY = 'unit-test-encryption-key'

const yookassaSettings = {
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
const stripeSettings = {
    ...yookassaSettings,
    provider: 'STRIPE',
    shopId: null,
    secretKeyEncrypted: encryptPaymentSecret('sk_test_1234', KEY),
    webhookSecretEncrypted: encryptPaymentSecret('whsec_club', KEY),
}

const prismaFor = (settings: unknown, known = true) => ({
    workspacePaymentSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
    payment: {
        findFirst: jest.fn().mockResolvedValue(known ? { id: 'pay-1' } : null),
    },
})

describe('YooKassa webhook', () => {
    const notification = {
        type: 'notification',
        event: 'payment.succeeded',
        // A forged body: claims success, but only the id is ever read.
        object: { id: 'yk-1', status: 'succeeded', paid: true },
    }
    const run = (prisma: unknown, gateway: unknown, activation: unknown, body: unknown = notification) =>
        new HandleYookassaWebhookHandler(
            prisma as never,
            gateway as never,
            activation as never,
        ).execute(new HandleYookassaWebhookFeature('ws-1', body))

    it('re-reads the payment with the club keys and applies THAT status', async () => {
        const fetched = {
            providerPaymentId: 'yk-1',
            status: 'PENDING',
            confirmationUrl: null,
            amountMinor: 450000,
            currency: 'RUB',
        }
        const gateway = { getPayment: jest.fn().mockResolvedValue(fetched) }
        const activation = { applyProviderStatus: jest.fn().mockResolvedValue('unchanged') }
        expect(await run(prismaFor(yookassaSettings), gateway, activation)).toEqual({
            received: true,
        })
        expect(gateway.getPayment.mock.calls[0]).toEqual([
            expect.objectContaining({ shopId: '123456', secretKey: 'live_key_1234' }),
            'yk-1',
        ])
        expect(activation.applyProviderStatus).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            gateway: fetched,
        })
    })

    it('acknowledges an unknown payment without calling YooKassa', async () => {
        const gateway = { getPayment: jest.fn() }
        const activation = { applyProviderStatus: jest.fn() }
        expect(await run(prismaFor(yookassaSettings, false), gateway, activation)).toEqual({
            received: true,
        })
        expect(gateway.getPayment).not.toHaveBeenCalled()
        expect(activation.applyProviderStatus).not.toHaveBeenCalled()
    })

    it('ignores an API answer about another payment', async () => {
        const gateway = {
            getPayment: jest.fn().mockResolvedValue({ providerPaymentId: 'other', status: 'SUCCEEDED' }),
        }
        const activation = { applyProviderStatus: jest.fn() }
        await run(prismaFor(yookassaSettings), gateway, activation)
        expect(activation.applyProviderStatus).not.toHaveBeenCalled()
    })

    it('400s a malformed body and 404s a club without YooKassa', async () => {
        await expect(
            run(prismaFor(yookassaSettings), {}, {}, { nope: true }),
        ).rejects.toMatchObject({ statusCode: 400 })
        for (const s of [null, stripeSettings]) {
            await expect(run(prismaFor(s), {}, {})).rejects.toMatchObject({
                statusCode: 404,
            })
        }
    })

    it('answers 500 when YooKassa cannot be reached, so it retries', async () => {
        const gateway = {
            getPayment: jest.fn().mockRejectedValue(new PaymentGatewayError('x', null)),
        }
        await expect(
            run(prismaFor(yookassaSettings), gateway, { applyProviderStatus: jest.fn() }),
        ).rejects.toMatchObject({ statusCode: 500 })
        const bug = { getPayment: jest.fn().mockRejectedValue(new Error('bug')) }
        await expect(run(prismaFor(yookassaSettings), bug, {})).rejects.toThrow('bug')
    })
})

describe('Stripe webhook', () => {
    const now = Math.floor(Date.now() / 1000)
    const event = (type: string, object: Record<string, unknown>) =>
        JSON.stringify({ id: 'evt_1', type, data: { object } })
    const session = {
        id: 'cs_1',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 450000,
        currency: 'rub',
        metadata: { paymentId: 'pay-1', workspaceId: 'ws-1' },
    }
    const signed = (body: string, secret = 'whsec_club', t = now) =>
        `t=${t},v1=${signStripePayload(body, secret, t)}`
    const run = (prisma: unknown, activation: unknown, body: string | null, signature?: string) =>
        new HandleStripeWebhookHandler(prisma as never, activation as never).execute(
            new HandleStripeWebhookFeature(
                'ws-1',
                body === null ? null : Buffer.from(body),
                signature,
            ),
        )

    it('rejects a bad signature with 401 before reading the body', async () => {
        const body = event('checkout.session.completed', session)
        const activation = { applyProviderStatus: jest.fn() }
        for (const sig of [
            undefined,
            'garbage',
            signed(body, 'whsec_other'),
            signed(body, 'whsec_club', now - 600),
        ]) {
            await expect(
                run(prismaFor(stripeSettings), activation, body, sig),
            ).rejects.toMatchObject({ statusCode: 401 })
        }
        await expect(
            run(prismaFor(stripeSettings), activation, null, signed(body)),
        ).rejects.toMatchObject({ statusCode: 401 })
        expect(activation.applyProviderStatus).not.toHaveBeenCalled()
    })

    it('404s a club without Stripe', async () => {
        for (const s of [null, yookassaSettings]) {
            await expect(run(prismaFor(s), {}, '{}', 't=1,v1=a')).rejects.toMatchObject({
                statusCode: 404,
            })
        }
    })

    it('applies a signed completed session', async () => {
        const body = event('checkout.session.completed', session)
        const activation = { applyProviderStatus: jest.fn().mockResolvedValue('activated') }
        expect(
            await run(prismaFor(stripeSettings), activation, body, signed(body)),
        ).toEqual({ received: true })
        expect(activation.applyProviderStatus).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            gateway: {
                providerPaymentId: 'cs_1',
                status: 'SUCCEEDED',
                confirmationUrl: null,
                amountMinor: 450000,
                currency: 'RUB',
            },
        })
    })

    it('cancels on a failed async payment and on expiry', async () => {
        for (const [type, obj] of [
            ['checkout.session.async_payment_failed', { ...session, payment_status: 'unpaid' }],
            ['checkout.session.expired', { ...session, status: 'expired', payment_status: 'unpaid' }],
        ] as const) {
            const body = event(type, obj)
            const activation = { applyProviderStatus: jest.fn() }
            await run(prismaFor(stripeSettings), activation, body, signed(body))
            expect(activation.applyProviderStatus.mock.calls[0][0].gateway.status).toBe(
                'CANCELED',
            )
        }
    })

    it('acknowledges other event types without acting', async () => {
        const body = event('customer.created', { id: 'cus_1' })
        const activation = { applyProviderStatus: jest.fn() }
        expect(
            await run(prismaFor(stripeSettings), activation, body, signed(body)),
        ).toEqual({ received: true })
        expect(activation.applyProviderStatus).not.toHaveBeenCalled()
    })

    it('400s a signed but malformed event', async () => {
        for (const body of ['not json', event('checkout.session.completed', { no: 'id' })]) {
            await expect(
                run(prismaFor(stripeSettings), { applyProviderStatus: jest.fn() }, body, signed(body)),
            ).rejects.toMatchObject({ statusCode: 400 })
        }
    })
})
