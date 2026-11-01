import {
    buildStripeBalance,
    buildStripeCheckoutSession,
    buildStripeGetCheckoutSession,
    buildStripeRefund,
    encodeStripeForm,
    parseStripeBalance,
    parseStripeCheckoutSession,
    stripeErrorMessage,
    stripePaymentIntentId,
} from './stripe-api'
import { toMinorUnits } from './payment-gateway.types'

const input = {
    paymentId: 'pay-1',
    workspaceId: 'ws-1',
    idempotenceKey: 'idem-1',
    amount: 45,
    currency: 'EUR',
    description: 'Membership — Club',
    itemName: 'Membership',
    returnUrl: 'https://app.example.com/payment/pay-1',
    customerEmail: 'member@example.com',
}

describe('Stripe form encoding', () => {
    it('flattens nested objects and arrays in bracket notation', () => {
        const body = encodeStripeForm({
            a: 1,
            b: { c: 'x y', d: [{ e: true }] },
            skip: undefined,
            none: null,
        })
        expect(decodeURIComponent(body)).toBe('a=1&b[c]=x+y&b[d][0][e]=true')
    })
})

describe('Stripe request building', () => {
    it('creates a Checkout Session with an Idempotency-Key', () => {
        const req = buildStripeCheckoutSession('sk_test_1', input)
        expect(req.method).toBe('POST')
        expect(req.url).toBe('https://api.stripe.com/v1/checkout/sessions')
        expect(req.headers).toEqual({
            Authorization: 'Bearer sk_test_1',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': 'idem-1',
        })
        const params = Object.fromEntries(new URLSearchParams(req.body!))
        expect(params).toEqual({
            mode: 'payment',
            success_url: input.returnUrl,
            cancel_url: input.returnUrl,
            customer_email: 'member@example.com',
            client_reference_id: 'pay-1',
            'line_items[0][quantity]': '1',
            'line_items[0][price_data][currency]': 'eur',
            'line_items[0][price_data][unit_amount]': '4500',
            'line_items[0][price_data][product_data][name]': 'Membership',
            'metadata[paymentId]': 'pay-1',
            'metadata[workspaceId]': 'ws-1',
            'payment_intent_data[description]': 'Membership — Club',
            'payment_intent_data[metadata][paymentId]': 'pay-1',
            'payment_intent_data[metadata][workspaceId]': 'ws-1',
        })
    })

    it('keeps zero-decimal currencies in whole units', () => {
        expect(toMinorUnits(1000, 'jpy')).toBe(1000)
        expect(toMinorUnits(1000, 'RUB')).toBe(100000)
    })

    it('reads a session, refunds its payment intent, reads the balance', () => {
        expect(buildStripeGetCheckoutSession('sk_test_1', 'cs_1')).toEqual({
            method: 'GET',
            url: 'https://api.stripe.com/v1/checkout/sessions/cs_1',
            headers: { Authorization: 'Bearer sk_test_1' },
        })
        const refund = buildStripeRefund('sk_test_1', {
            paymentIntentId: 'pi_1',
            paymentId: 'pay-1',
            idempotenceKey: 'refund-pay-1',
        })
        expect(refund.headers['Idempotency-Key']).toBe('refund-pay-1')
        expect(Object.fromEntries(new URLSearchParams(refund.body!))).toEqual({
            payment_intent: 'pi_1',
            'metadata[paymentId]': 'pay-1',
        })
        expect(buildStripeBalance('sk_test_1').url).toBe(
            'https://api.stripe.com/v1/balance',
        )
    })
})

describe('Stripe response parsing', () => {
    it('maps session states', () => {
        const base = { id: 'cs_1', amount_total: 4500, currency: 'eur' }
        expect(
            parseStripeCheckoutSession({
                ...base,
                status: 'complete',
                payment_status: 'paid',
            }),
        ).toEqual({
            providerPaymentId: 'cs_1',
            status: 'SUCCEEDED',
            confirmationUrl: null,
            amountMinor: 4500,
            currency: 'EUR',
        })
        expect(
            parseStripeCheckoutSession({
                ...base,
                status: 'open',
                payment_status: 'unpaid',
                url: 'https://checkout.stripe.com/c/pay/cs_1',
            }),
        ).toMatchObject({
            status: 'PENDING',
            confirmationUrl: 'https://checkout.stripe.com/c/pay/cs_1',
        })
        expect(
            parseStripeCheckoutSession({ ...base, status: 'expired' }).status,
        ).toBe('CANCELED')
    })

    it('finds the payment intent id in either shape', () => {
        expect(stripePaymentIntentId({ id: 'cs', payment_intent: 'pi_1' })).toBe(
            'pi_1',
        )
        expect(
            stripePaymentIntentId({ id: 'cs', payment_intent: { id: 'pi_2' } }),
        ).toBe('pi_2')
        expect(stripePaymentIntentId({ id: 'cs', payment_intent: null })).toBe(
            null,
        )
    })

    it('reads test mode and error messages', () => {
        expect(parseStripeBalance({ livemode: false })).toEqual({
            accountId: null,
            testMode: true,
        })
        expect(parseStripeBalance({ livemode: true }).testMode).toBe(false)
        expect(stripeErrorMessage({ error: { message: 'Invalid API Key' } })).toBe(
            'Invalid API Key',
        )
        expect(stripeErrorMessage(null)).toBeNull()
    })
})
