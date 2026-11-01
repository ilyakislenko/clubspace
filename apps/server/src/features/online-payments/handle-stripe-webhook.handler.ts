import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { stripeWebhookSecret } from '../../domains/payments/payment-credentials'
import type { GatewayPayment } from '../../domains/payments/payment-gateway.types'
import { PaymentActivationService } from '../../domains/payments/services/payment-activation.service'
import {
    StripeCheckoutSessionSchema,
    toGatewayPayment,
} from '../../domains/payments/stripe-api'
import { verifyStripeSignature } from '../../domains/payments/stripe-signature'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
} from '../../shared/errors/shared.errors'
import {
    HandleStripeWebhookFeature,
    PaymentWebhookFeatureResponse,
} from './handle-payment-webhook.feature'

const EventSchema = z.object({
    type: z.string(),
    data: z.object({ object: z.unknown() }),
})

// The Checkout Session events that settle a payment.
const SETTLING_EVENTS: Record<string, true> = {
    'checkout.session.completed': true,
    'checkout.session.async_payment_succeeded': true,
    'checkout.session.async_payment_failed': true,
    'checkout.session.expired': true,
}

// Stripe signs every delivery; nothing in the body is read before the
// signature over the raw bytes checks out with the club's signing secret.
@Feature(HandleStripeWebhookFeature)
export class HandleStripeWebhookHandler
    implements
        IFeatureHandler<HandleStripeWebhookFeature, PaymentWebhookFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly activation: PaymentActivationService,
    ) {}

    async execute(
        f: HandleStripeWebhookFeature,
    ): Promise<PaymentWebhookFeatureResponse> {
        const settings = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        const secret =
            settings?.provider === 'STRIPE'
                ? stripeWebhookSecret(settings, environment.encryptionKey)
                : null
        if (!secret) throw new NotFoundError({ message: 'Stripe is not connected' })
        if (
            !f.rawBody ||
            !verifyStripeSignature({
                payload: f.rawBody,
                header: f.signature,
                secret,
                nowSeconds: Math.floor(Date.now() / 1000),
            })
        ) {
            throw new UnauthorizedError({ message: 'Invalid Stripe signature' })
        }

        let event: z.infer<typeof EventSchema>
        let session: z.infer<typeof StripeCheckoutSessionSchema>
        try {
            event = EventSchema.parse(JSON.parse(f.rawBody.toString('utf8')))
            if (!SETTLING_EVENTS[event.type]) return { received: true }
            session = StripeCheckoutSessionSchema.parse(event.data.object)
        } catch {
            throw new BadRequestError({ message: 'Malformed event' })
        }

        const gateway: GatewayPayment =
            event.type === 'checkout.session.async_payment_failed'
                ? { ...toGatewayPayment(session), status: 'CANCELED' }
                : toGatewayPayment(session)
        await this.activation.applyProviderStatus({
            workspaceId: f.workspaceId,
            gateway,
        })
        return { received: true }
    }
}
