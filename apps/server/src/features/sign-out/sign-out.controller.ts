import { Body, Controller, Headers, Post, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    clearRefreshCookie,
    readRefreshCookie,
    TOKEN_TRANSPORT_HEADER,
    wantsCookieTransport,
} from '../../shared/utils/refresh-cookie.util'
import {
    SignOutFeature,
    SignOutFeatureInputSchema,
    SignOutFeatureOutputSchema,
    SignOutFeatureResponse,
} from './sign-out.feature'

class SignOutInput extends createZodDto(SignOutFeatureInputSchema) {}

class SignOutOutput extends createZodDto(SignOutFeatureOutputSchema) {}

@Controller()
export class SignOutController {
    constructor(private bus: FeaturesBus) {}

    @Post('sign-out')
    @ApiTags('Authentication')
    @ZodResponse({ type: SignOutOutput })
    async signOut(
        @Body() input: SignOutInput,
        @Headers(TOKEN_TRANSPORT_HEADER) transport: string | undefined,
        @Headers('origin') origin: string | undefined,
        @Headers('cookie') cookie: string | undefined,
        @Res({ passthrough: true }) res: Response,
    ) {
        const cookieMode = wantsCookieTransport({ transport, origin })
        const result = await this.bus.execute<SignOutFeature, SignOutFeatureResponse>(
            new SignOutFeature({
                refreshToken:
                    input.refreshToken ??
                    (cookieMode ? readRefreshCookie(cookie) : undefined),
            }),
        )
        if (cookieMode) clearRefreshCookie(res)
        return result
    }
}
