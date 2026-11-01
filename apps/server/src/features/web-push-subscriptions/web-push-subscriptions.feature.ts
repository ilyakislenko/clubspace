import { z } from 'zod'

import { environment } from '../../environments/environment'

// A push service URL from PushSubscription.endpoint. HTTPS only in production;
// development and the e2e suite point it at a local receiver.
const endpointSchema = z
    .url()
    .max(2048)
    .refine(
        (url) => url.startsWith('https://') || !environment.production,
        'endpoint must be an https:// URL',
    )

export const SubscribeWebPushInputSchema = z.object({
    endpoint: endpointSchema,
    // PushSubscription.toJSON().keys — base64url P-256 point and auth secret.
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
    userAgent: z.string().max(512).optional(),
})

export const SubscribeWebPushOutputSchema = z.object({
    status: z.literal('subscribed'),
})

export class SubscribeWebPushFeature {
    constructor(
        readonly userId: string,
        readonly payload: z.infer<typeof SubscribeWebPushInputSchema>,
    ) {}
}

export type SubscribeWebPushFeatureResponse = z.infer<
    typeof SubscribeWebPushOutputSchema
>

export const UnsubscribeWebPushInputSchema = z.object({
    endpoint: z.string().min(1).max(2048),
})

export const UnsubscribeWebPushOutputSchema = z.object({
    status: z.literal('removed'),
})

export class UnsubscribeWebPushFeature {
    constructor(
        readonly userId: string,
        readonly endpoint: string,
    ) {}
}

export type UnsubscribeWebPushFeatureResponse = z.infer<
    typeof UnsubscribeWebPushOutputSchema
>

export const WebPushConfigOutputSchema = z.object({
    // The VAPID applicationServerKey; null when the server has web push off.
    publicKey: z.string().nullable(),
})

export class GetWebPushConfigFeature {}

export type GetWebPushConfigFeatureResponse = z.infer<
    typeof WebPushConfigOutputSchema
>
