import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    ResendCodeFeature,
    ResendCodeFeatureInputSchema,
    ResendCodeFeatureOutputSchema,
    ResendCodeFeatureResponse,
} from './resend-code.feature'

class ResendCodeInput extends createZodDto(ResendCodeFeatureInputSchema) {}

class ResendCodeOutput extends createZodDto(ResendCodeFeatureOutputSchema) {}

@Controller()
export class ResendCodeController {
    constructor(private bus: FeaturesBus) {}

    @Post('resend-code')
    @ApiTags('Authentication')
    @ZodResponse({ type: ResendCodeOutput })
    // Always per IP (trackByClientIp), sized for a group signing up together
    // on the club Wi-Fi. The real brake is per account — one code per
    // COMPLETE_CODE_TIMEOUT, and wrong codes lock the guessing address (and,
    // past a ceiling, the account) — see SignInHandler.
    @Throttle({ default: { ttl: 60_000, limit: 30, getTracker: trackByClientIp } })
    async resendCode(@Body() input: ResendCodeInput) {
        return await this.bus.execute<
            ResendCodeFeature,
            ResendCodeFeatureResponse
        >(new ResendCodeFeature(input))
    }
}
