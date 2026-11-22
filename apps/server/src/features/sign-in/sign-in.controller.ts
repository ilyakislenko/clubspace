import { Body, Controller, Headers, Ip, Post, Res } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import {
    deliverSession,
    TOKEN_TRANSPORT_HEADER,
} from '../../shared/utils/refresh-cookie.util'
import {
    SignInFeature,
    SignInFeatureInputSchema,
    SignInFeatureOutputSchema,
    SignInFeatureResponse,
} from './sign-in.feature'

class SignInInput extends createZodDto(SignInFeatureInputSchema) {}

class SignInOutput extends createZodDto(SignInFeatureOutputSchema) {}

@Controller()
export class SignInController {
    constructor(private bus: FeaturesBus) {}

    @Post('sign-in')
    @ApiTags('Authentication')
    @ZodResponse({ type: SignInOutput })
    // Always per IP (trackByClientIp), sized for a gym on one Wi-Fi; OTP
    // brute force is stopped by the per-address and per-account lockouts in
    // the handler, not by this.
    @Throttle({ default: { ttl: 60_000, limit: 60, getTracker: trackByClientIp } })
    async signIn(
        @Body() input: SignInInput,
        @Ip() ip: string,
        @Headers(TOKEN_TRANSPORT_HEADER) transport: string | undefined,
        @Headers('origin') origin: string | undefined,
        @Res({ passthrough: true }) res: Response,
    ) {
        const session = await this.bus.execute<SignInFeature, SignInFeatureResponse>(
            new SignInFeature(input, ip),
        )
        return deliverSession(res, { transport, origin }, session)
    }
}
