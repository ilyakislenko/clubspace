import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    SendAuthCodeFeature,
    SendAuthCodeFeatureInputSchema,
    SendAuthCodeFeatureOutputSchema,
    SendAuthCodeFeatureResponse,
} from './send-auth-code.feature'

class SendAuthCodeInput extends createZodDto(SendAuthCodeFeatureInputSchema) {}

class SendAuthCodeOutput extends createZodDto(
    SendAuthCodeFeatureOutputSchema,
) {}

@Controller()
export class SendAuthCodeController {
    constructor(private bus: FeaturesBus) {}

    @Post('send-auth-code')
    @ApiTags('Authentication')
    @ZodResponse({ type: SendAuthCodeOutput })
    // Always per IP (trackByClientIp), sized for a group signing up together
    // on the club Wi-Fi. The real brake is per account — one code per
    // COMPLETE_CODE_TIMEOUT, and wrong codes lock the guessing address (and,
    // past a ceiling, the account) — see SignInHandler.
    @Throttle({ default: { ttl: 60_000, limit: 30, getTracker: trackByClientIp } })
    async sendAuthCode(@Body() input: SendAuthCodeInput) {
        return await this.bus.execute<
            SendAuthCodeFeature,
            SendAuthCodeFeatureResponse
        >(new SendAuthCodeFeature(input))
    }
}
