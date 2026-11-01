import { PaymentGatewayClient } from './payment-gateway.client'
import { PaymentGatewayError } from './payment-gateway.types'

const yookassa = {
    provider: 'YOOKASSA' as const,
    shopId: '123',
    secretKey: 'test_key',
    receipt: {
        enabled: true,
        vatCode: 1,
        paymentSubject: 'service',
        paymentMode: 'full_prepayment',
    },
}
const stripe = { provider: 'STRIPE' as const, secretKey: 'sk_test_key' }
const input = {
    paymentId: 'pay-1',
    workspaceId: 'ws-1',
    idempotenceKey: 'idem-1',
    amount: 100,
    currency: 'RUB',
    description: 'd',
    itemName: 'i',
    returnUrl: 'https://app.example.com/payment/pay-1',
    customerEmail: 'm@example.com',
}

const respond = (status: number, body: unknown) =>
    ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    }) as Response

describe('PaymentGatewayClient', () => {
    const realFetch = global.fetch
    let fetchMock: jest.Mock
    beforeEach(() => {
        fetchMock = jest.fn()
        global.fetch = fetchMock as never
    })
    afterAll(() => {
        global.fetch = realFetch
    })

    it('sends the built YooKassa request and parses the answer', async () => {
        fetchMock.mockResolvedValue(
            respond(200, {
                id: 'yk-1',
                status: 'pending',
                amount: { value: '100.00', currency: 'RUB' },
                confirmation: { confirmation_url: 'https://pay/yk-1' },
            }),
        )
        const out = await new PaymentGatewayClient().createPayment(yookassa, input)
        expect(out).toMatchObject({
            providerPaymentId: 'yk-1',
            confirmationUrl: 'https://pay/yk-1',
            status: 'PENDING',
        })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.yookassa.ru/v3/payments')
        expect(init.method).toBe('POST')
        expect(init.headers['Idempotence-Key']).toBe('idem-1')
        expect(init.headers.Accept).toBe('application/json')
    })

    it('turns a provider refusal into PaymentGatewayError with its message', async () => {
        fetchMock.mockResolvedValue(
            respond(401, { type: 'error', description: 'Invalid credentials' }),
        )
        const err = await new PaymentGatewayClient()
            .checkConnection(yookassa)
            .catch((e) => e)
        expect(err).toBeInstanceOf(PaymentGatewayError)
        expect(err.status).toBe(401)
        expect(err.providerMessage).toBe('Invalid credentials')
    })

    it('turns a network failure into PaymentGatewayError without a status', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNRESET'))
        const err = await new PaymentGatewayClient()
            .getPayment(stripe, 'cs_1')
            .catch((e) => e)
        expect(err).toBeInstanceOf(PaymentGatewayError)
        expect(err.status).toBeNull()
    })

    it('refunds a Stripe payment through the session payment intent', async () => {
        fetchMock
            .mockResolvedValueOnce(
                respond(200, { id: 'cs_1', payment_intent: 'pi_1' }),
            )
            .mockResolvedValueOnce(respond(200, { id: 're_1' }))
        await new PaymentGatewayClient().refund(stripe, {
            paymentId: 'pay-1',
            providerPaymentId: 'cs_1',
            amount: 100,
            currency: 'EUR',
            idempotenceKey: 'refund-pay-1',
        })
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://api.stripe.com/v1/checkout/sessions/cs_1',
        )
        const [url, init] = fetchMock.mock.calls[1]
        expect(url).toBe('https://api.stripe.com/v1/refunds')
        expect(init.headers['Idempotency-Key']).toBe('refund-pay-1')
        expect(init.body).toContain('payment_intent=pi_1')
    })

    it('refuses a Stripe refund when the session has no payment yet', async () => {
        fetchMock.mockResolvedValueOnce(
            respond(200, { id: 'cs_1', payment_intent: null }),
        )
        await expect(
            new PaymentGatewayClient().refund(stripe, {
                paymentId: 'pay-1',
                providerPaymentId: 'cs_1',
                amount: 100,
                currency: 'EUR',
                idempotenceKey: 'k',
            }),
        ).rejects.toBeInstanceOf(PaymentGatewayError)
    })

    it('refunds YooKassa directly and checks Stripe via the balance', async () => {
        fetchMock
            .mockResolvedValueOnce(respond(200, { id: 'rf_1', status: 'succeeded' }))
            .mockResolvedValueOnce(respond(200, { livemode: false }))
            .mockResolvedValueOnce(
                respond(200, { id: 'cs_1', status: 'open', url: 'https://c/cs_1' }),
            )
        const client = new PaymentGatewayClient()
        await client.refund(yookassa, {
            paymentId: 'pay-1',
            providerPaymentId: 'yk-1',
            amount: 100,
            currency: 'RUB',
            idempotenceKey: 'refund-pay-1',
        })
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.yookassa.ru/v3/refunds')
        expect(await client.checkConnection(stripe)).toEqual({
            accountId: null,
            testMode: true,
        })
        expect(await client.createPayment(stripe, input)).toMatchObject({
            providerPaymentId: 'cs_1',
            confirmationUrl: 'https://c/cs_1',
        })
    })
})
