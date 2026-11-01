import { Injectable } from '@nestjs/common'

import {
    type CreateGatewayPaymentInput,
    type GatewayConnectionInfo,
    type GatewayCredentials,
    type GatewayPayment,
    PaymentGatewayError,
    type ProviderRequest,
} from './payment-gateway.types'
import {
    buildStripeBalance,
    buildStripeCheckoutSession,
    buildStripeGetCheckoutSession,
    buildStripeRefund,
    parseStripeBalance,
    parseStripeCheckoutSession,
    stripeErrorMessage,
    stripePaymentIntentId,
} from './stripe-api'
import {
    buildYookassaCreatePayment,
    buildYookassaGetPayment,
    buildYookassaMe,
    buildYookassaRefund,
    parseYookassaMe,
    parseYookassaPayment,
    yookassaErrorMessage,
} from './yookassa-api'

// A hung provider must not pin a request (or a webhook) forever.
const REQUEST_TIMEOUT_MS = 15_000

// The one place that talks to YooKassa / Stripe over HTTPS (global fetch, no
// SDKs). Requests are built by the pure adapters; this class only sends them
// and maps errors. Injectable so specs and the e2e suite substitute it.
@Injectable()
export class PaymentGatewayClient {
    async createPayment(
        creds: GatewayCredentials,
        input: CreateGatewayPaymentInput,
    ): Promise<GatewayPayment> {
        if (creds.provider === 'YOOKASSA') {
            return parseYookassaPayment(
                await this.send(creds, buildYookassaCreatePayment(creds, input)),
            )
        }
        return parseStripeCheckoutSession(
            await this.send(
                creds,
                buildStripeCheckoutSession(creds.secretKey, input),
            ),
        )
    }

    async getPayment(
        creds: GatewayCredentials,
        providerPaymentId: string,
    ): Promise<GatewayPayment> {
        if (creds.provider === 'YOOKASSA') {
            return parseYookassaPayment(
                await this.send(
                    creds,
                    buildYookassaGetPayment(creds, providerPaymentId),
                ),
            )
        }
        return parseStripeCheckoutSession(
            await this.send(
                creds,
                buildStripeGetCheckoutSession(creds.secretKey, providerPaymentId),
            ),
        )
    }

    // A full refund. Throws PaymentGatewayError when the provider refuses.
    async refund(
        creds: GatewayCredentials,
        p: {
            paymentId: string
            providerPaymentId: string
            amount: number
            currency: string
            idempotenceKey: string
        },
    ): Promise<void> {
        if (creds.provider === 'YOOKASSA') {
            await this.send(creds, buildYookassaRefund(creds, p))
            return
        }
        // Stripe refunds the PaymentIntent behind the Checkout Session.
        const session = await this.send(
            creds,
            buildStripeGetCheckoutSession(creds.secretKey, p.providerPaymentId),
        )
        const paymentIntentId = stripePaymentIntentId(session)
        if (!paymentIntentId) {
            throw new PaymentGatewayError(
                'Stripe session has no payment intent',
                null,
                'Платёж ещё не проведён',
            )
        }
        await this.send(
            creds,
            buildStripeRefund(creds.secretKey, {
                paymentIntentId,
                paymentId: p.paymentId,
                idempotenceKey: p.idempotenceKey,
            }),
        )
    }

    async checkConnection(
        creds: GatewayCredentials,
    ): Promise<GatewayConnectionInfo> {
        if (creds.provider === 'YOOKASSA') {
            return parseYookassaMe(await this.send(creds, buildYookassaMe(creds)))
        }
        return parseStripeBalance(
            await this.send(creds, buildStripeBalance(creds.secretKey)),
        )
    }

    private async send(
        creds: GatewayCredentials,
        req: ProviderRequest,
    ): Promise<unknown> {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        let res: Response
        try {
            res = await fetch(req.url, {
                method: req.method,
                headers: { Accept: 'application/json', ...req.headers },
                body: req.body,
                signal: controller.signal,
            })
        } catch (err) {
            throw new PaymentGatewayError(
                `${creds.provider} ${req.method} ${new URL(req.url).pathname} failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
                null,
            )
        } finally {
            clearTimeout(timeout)
        }
        const text = await res.text()
        let json: unknown = null
        try {
            json = text ? JSON.parse(text) : null
        } catch {
            json = null
        }
        if (!res.ok) {
            const providerMessage =
                creds.provider === 'YOOKASSA'
                    ? yookassaErrorMessage(json)
                    : stripeErrorMessage(json)
            throw new PaymentGatewayError(
                `${creds.provider} ${req.method} ${new URL(req.url).pathname} answered ${res.status}`,
                res.status,
                providerMessage,
            )
        }
        return json
    }
}
