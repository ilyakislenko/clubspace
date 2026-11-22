import { Body, Controller, Headers, Post, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { TokenNotFoundError } from '../../domains/tokens/errors/tokens.errors'
import {
    deliverSession,
    readRefreshCookie,
    TOKEN_TRANSPORT_HEADER,
    wantsCookieTransport,
} from '../../shared/utils/refresh-cookie.util'
import {
    RefreshTokenFeature,
    RefreshTokenFeatureInputSchema,
    RefreshTokenFeatureOutputSchema,
    RefreshTokenFeatureResponse,
} from './refresh-token.feature'

class RefreshTokenInput extends createZodDto(RefreshTokenFeatureInputSchema) {}

class RefreshTokenOutput extends createZodDto(
    RefreshTokenFeatureOutputSchema,
) {}

@Controller()
export class RefreshTokenController {
    constructor(private bus: FeaturesBus) {}

    @Post('refresh-token')
    @ApiTags('Authentication')
    @ZodResponse({ type: RefreshTokenOutput })
    async refreshToken(
        @Body() input: RefreshTokenInput,
        @Headers(TOKEN_TRANSPORT_HEADER) transport: string | undefined,
        @Headers('origin') origin: string | undefined,
        @Headers('cookie') cookie: string | undefined,
        @Res({ passthrough: true }) res: Response,
    ) {
        const request = { transport, origin }
        // The body wins; the cookie only in the cookie transport.
        const refreshToken =
            input.refreshToken ??
            (wantsCookieTransport(request) ? readRefreshCookie(cookie) : undefined)
        if (!refreshToken) throw new TokenNotFoundError()

        const session = await this.bus.execute<
            RefreshTokenFeature,
            RefreshTokenFeatureResponse
        >(new RefreshTokenFeature({ refreshToken }))
        return deliverSession(res, request, session)
    }
}
