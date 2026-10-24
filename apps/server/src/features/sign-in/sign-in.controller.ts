import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import { TfaRequestGroupEnum } from '../../domains/tfa/interfaces/tfa.interfaces'
import { TfaGroup } from '../../shared/decorators'
import { TfaGuard } from '../../shared/guards/tfa.guard'
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
    @UseGuards(TfaGuard)
    @TfaGroup(TfaRequestGroupEnum.AUTH)
    // Always per IP (trackByClientIp), sized for a gym on one Wi-Fi; OTP
    // brute force is stopped by the per-account lockout, not by this.
    @Throttle({ default: { ttl: 60_000, limit: 60, getTracker: trackByClientIp } })
    async signIn(@Body() input: SignInInput) {
        return await this.bus.execute<SignInFeature, SignInFeatureResponse>(
            new SignInFeature(input),
        )
    }
}
