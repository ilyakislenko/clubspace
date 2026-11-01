import { z } from 'zod'

import {
    type CreateGatewayPaymentInput,
    type GatewayConnectionInfo,
    type GatewayPayment,
    type ProviderRequest,
    toMinorUnits,
} from './payment-gateway.types'

// Stripe API: https://docs.stripe.com/api — form-encoded bodies, Bearer auth
// with the secret key, Idempotency-Key on every POST. The member pays on a
// hosted Checkout Session page; its id is our providerPaymentId.

export const STRIPE_API_URL = 'https://api.stripe.com/v1'

type FormValue = string | number | boolean | null | undefined | FormObject | FormValue[]
type FormObject = { [key: string]: FormValue }

// Stripe's bracket notation: { a: { b: [ { c: 1 } ] } } → a[b][0][c]=1.
// null/undefined fields are left out.
export const encodeStripeForm = (params: FormObject): string => {
    const pairs: Array<[string, string]> = []
    const walk = (prefix: string, value: FormValue) => {
        if (value === null || value === undefined) return
        if (Array.isArray(value)) {
            value.forEach((v, i) => walk(`${prefix}[${i}]`, v))
            return
        }
        if (typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
                walk(prefix ? `${prefix}[${k}]` : k, v)
            }
            return
        }
        pairs.push([prefix, String(value)])
    }
    walk('', params)
    return new URLSearchParams(pairs).toString()
}

const headers = (secretKey: string) => ({
    Authorization: `Bearer ${secretKey}`,
})

const formPost = (
    secretKey: string,
    path: string,
    idempotencyKey: string,
    params: FormObject,
): ProviderRequest => ({
    method: 'POST',
    url: `${STRIPE_API_URL}${path}`,
    headers: {
        ...headers(secretKey),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
    },
    body: encodeStripeForm(params),
})

export const buildStripeCheckoutSession = (
    secretKey: string,
    input: CreateGatewayPaymentInput,
): ProviderRequest => {
    const metadata = {
        paymentId: input.paymentId,
        workspaceId: input.workspaceId,
    }
    return formPost(secretKey, '/checkout/sessions', input.idempotenceKey, {
        mode: 'payment',
        // Both lead back to the same screen, which reads the real status.
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        customer_email: input.customerEmail,
        client_reference_id: input.paymentId,
        line_items: [
            {
                quantity: 1,
                price_data: {
                    currency: input.currency.toLowerCase(),
                    unit_amount: toMinorUnits(input.amount, input.currency),
                    product_data: { name: input.itemName },
                },
            },
        ],
        metadata,
        payment_intent_data: { description: input.description, metadata },
    })
}

export const buildStripeGetCheckoutSession = (
    secretKey: string,
    sessionId: string,
): ProviderRequest => ({
    method: 'GET',
    url: `${STRIPE_API_URL}/checkout/sessions/${encodeURIComponent(sessionId)}`,
    headers: headers(secretKey),
})

// A full refund of the session's PaymentIntent.
export const buildStripeRefund = (
    secretKey: string,
    p: { paymentIntentId: string; paymentId: string; idempotenceKey: string },
): ProviderRequest =>
    formPost(secretKey, '/refunds', p.idempotenceKey, {
        payment_intent: p.paymentIntentId,
        metadata: { paymentId: p.paymentId },
    })

// The cheapest authenticated read.
export const buildStripeBalance = (secretKey: string): ProviderRequest => ({
    method: 'GET',
    url: `${STRIPE_API_URL}/balance`,
    headers: headers(secretKey),
})

export const StripeCheckoutSessionSchema = z.object({
    id: z.string().min(1),
    url: z.string().nullish(),
    status: z.string().nullish(),
    payment_status: z.string().nullish(),
    amount_total: z.number().int().nullish(),
    currency: z.string().nullish(),
    payment_intent: z
        .union([z.string(), z.object({ id: z.string() })])
        .nullish(),
    metadata: z.record(z.string(), z.string()).nullish(),
})
export type StripeCheckoutSession = z.infer<typeof StripeCheckoutSessionSchema>

export const toGatewayPayment = (
    session: StripeCheckoutSession,
): GatewayPayment => ({
    providerPaymentId: session.id,
    status:
        session.payment_status === 'paid'
            ? 'SUCCEEDED'
            : session.status === 'expired'
              ? 'CANCELED'
              : 'PENDING',
    confirmationUrl: session.url ?? null,
    amountMinor: session.amount_total ?? null,
    currency: session.currency ? session.currency.toUpperCase() : null,
})

export const parseStripeCheckoutSession = (json: unknown): GatewayPayment =>
    toGatewayPayment(StripeCheckoutSessionSchema.parse(json))

export const stripePaymentIntentId = (json: unknown): string | null => {
    const pi = StripeCheckoutSessionSchema.parse(json).payment_intent
    if (!pi) return null
    return typeof pi === 'string' ? pi : pi.id
}

const StripeBalanceSchema = z.object({ livemode: z.boolean().optional() })

export const parseStripeBalance = (json: unknown): GatewayConnectionInfo => ({
    accountId: null,
    testMode: StripeBalanceSchema.parse(json).livemode !== true,
})

const StripeErrorSchema = z.object({ error: z.object({ message: z.string() }) })

export const stripeErrorMessage = (json: unknown): string | null =>
    StripeErrorSchema.safeParse(json).data?.error.message ?? null
