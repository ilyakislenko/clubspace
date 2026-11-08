import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import {
    HandleTelegramWebhookFeature,
    type HandleTelegramWebhookFeatureResponse,
    TelegramWebhookOutputSchema,
} from './telegram-link.feature'

class TelegramWebhookOutput extends createZodDto(TelegramWebhookOutputSchema) {}

// Every update arrives from a handful of Telegram addresses, so the per-IP
// buckets are wider than the global ones; anyone else is refused by the secret.
const TELEGRAM_WEBHOOK_THROTTLE = {
    short: { ttl: 1_000, limit: 50, getTracker: trackByClientIp },
    default: { ttl: 60_000, limit: 1_200, getTracker: trackByClientIp },
}

// Public: Telegram calls it (no session). Authenticated by the
// X-Telegram-Bot-Api-Secret-Token header in the handler.
@Controller('telegram')
@ApiTags('Telegram')
export class TelegramWebhookController {
    constructor(private bus: FeaturesBus) {}

    @Post('webhook')
    @HttpCode(200)
    @Throttle(TELEGRAM_WEBHOOK_THROTTLE)
    @ZodResponse({ type: TelegramWebhookOutput })
    async handleTelegramWebhook(
        @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
        @Body() body: unknown,
    ) {
        return this.bus.execute<
            HandleTelegramWebhookFeature,
            HandleTelegramWebhookFeatureResponse
        >(new HandleTelegramWebhookFeature(secretToken, body))
    }
}
