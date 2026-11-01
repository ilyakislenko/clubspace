import {
    Body,
    Controller,
    Headers,
    HttpCode,
    Param,
    ParseUUIDPipe,
    Post,
    Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import {
    HandlePlatformYookassaWebhookFeature,
    HandleStripeWebhookFeature,
    HandleYookassaWebhookFeature,
    PaymentWebhookOutputSchema,
    type PaymentWebhookFeatureResponse,
} from './handle-payment-webhook.feature'

class PaymentWebhookOutput extends createZodDto(PaymentWebhookOutputSchema) {}

// Provider notifications: public (no session — the provider calls them), per
// IP throttled. Each is bound to one club by the path, and authenticated by
// the provider-specific check in its handler (YooKassa: re-read from the API
// with the club's keys; Stripe: signature with the club's signing secret).
const WEBHOOK_THROTTLE = {
    default: { ttl: 60_000, limit: 300, getTracker: trackByClientIp },
}

@Controller('payments/webhooks')
@ApiTags('Payments')
export class PaymentWebhooksController {
    constructor(private bus: FeaturesBus) {}

    // The platform's own shop: clubs paying ClubSpace (card payments and
    // autopay renewals). Declared before the per-club route; the paths do not
    // overlap anyway (`platform/…` vs `yookassa/:uuid`).
    @Post('platform/yookassa')
    @HttpCode(200)
    @Throttle(WEBHOOK_THROTTLE)
    @ZodResponse({ type: PaymentWebhookOutput })
    async handlePlatformYookassaWebhook(@Body() body: unknown) {
        return this.bus.execute<
            HandlePlatformYookassaWebhookFeature,
            PaymentWebhookFeatureResponse
        >(new HandlePlatformYookassaWebhookFeature(body))
    }

    @Post('yookassa/:workspaceId')
    @HttpCode(200)
    @Throttle(WEBHOOK_THROTTLE)
    @ZodResponse({ type: PaymentWebhookOutput })
    async handleYookassaWebhook(
        @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
        @Body() body: unknown,
    ) {
        return this.bus.execute<
            HandleYookassaWebhookFeature,
            PaymentWebhookFeatureResponse
        >(new HandleYookassaWebhookFeature(workspaceId, body))
    }

    // Needs the exact bytes Stripe signed: main.ts boots with rawBody: true.
    @Post('stripe/:workspaceId')
    @HttpCode(200)
    @Throttle(WEBHOOK_THROTTLE)
    @ZodResponse({ type: PaymentWebhookOutput })
    async handleStripeWebhook(
        @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
        @Req() req: { rawBody?: Buffer },
        @Headers('stripe-signature') signature: string | undefined,
    ) {
        return this.bus.execute<
            HandleStripeWebhookFeature,
            PaymentWebhookFeatureResponse
        >(
            new HandleStripeWebhookFeature(
                workspaceId,
                req.rawBody ?? null,
                signature,
            ),
        )
    }
}
