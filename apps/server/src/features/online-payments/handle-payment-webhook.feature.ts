import { z } from 'zod'

// Providers only look at the status code; the body is for logs.
export const PaymentWebhookOutputSchema = z.object({ received: z.literal(true) })

// YooKassa: the body is NOT trusted — only the payment id is read from it, and
// the payment is re-fetched from the API with the club's credentials.
export class HandleYookassaWebhookFeature {
    constructor(
        readonly workspaceId: string,
        readonly body: unknown,
    ) {}
}

// Stripe: the raw body is verified against Stripe-Signature with the club's
// webhook signing secret before anything in it is used.
export class HandleStripeWebhookFeature {
    constructor(
        readonly workspaceId: string,
        readonly rawBody: Buffer | null,
        readonly signature: string | undefined,
    ) {}
}

export type PaymentWebhookFeatureResponse = z.infer<
    typeof PaymentWebhookOutputSchema
>

// The platform's own YooKassa shop (clubs paying ClubSpace). Same rule as the
// club webhook: only the payment id is read, the payment is re-fetched with
// the platform's credentials.
export class HandlePlatformYookassaWebhookFeature {
    constructor(readonly body: unknown) {}
}
