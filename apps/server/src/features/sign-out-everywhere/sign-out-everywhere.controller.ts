import {
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Post,
    Res,
    UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    clearRefreshCookie,
    TOKEN_TRANSPORT_HEADER,
    wantsCookieTransport,
} from '../../shared/utils/refresh-cookie.util'
import {
    SignOutEverywhereFeature,
    SignOutEverywhereFeatureOutputSchema,
    SignOutEverywhereFeatureResponse,
} from './sign-out-everywhere.feature'

class SignOutEverywhereOutput extends createZodDto(
    SignOutEverywhereFeatureOutputSchema,
) {}

@Controller('me')
@UseGuards(AuthGuard)
export class SignOutEverywhereController {
    constructor(private bus: FeaturesBus) {}

    @Post('sign-out-everywhere')
    @ApiTags('Authentication')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: SignOutEverywhereOutput })
    async signOutEverywhere(
        @CurrentUser() user: CurrentUserPayload,
        @Headers(TOKEN_TRANSPORT_HEADER) transport: string | undefined,
        @Headers('origin') origin: string | undefined,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.bus.execute<
            SignOutEverywhereFeature,
            SignOutEverywhereFeatureResponse
        >(new SignOutEverywhereFeature(user.userId))
        // Every family is revoked; this browser's cookie goes too.
        if (wantsCookieTransport({ transport, origin })) clearRefreshCookie(res)
        return result
    }
}
