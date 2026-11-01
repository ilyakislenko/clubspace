import {
    Body,
    Controller,
    Get,
    Headers,
    Ip,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { SkipConsentCheck } from '../../shared/decorators/skip-consent-check.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    AcceptMyConsentFeature,
    AcceptMyConsentFeatureInputSchema,
    AcceptMyConsentFeatureOutputSchema,
    AcceptMyConsentFeatureResponse,
} from './accept-my-consent.feature'
import {
    GetMyConsentFeature,
    GetMyConsentFeatureOutputSchema,
    GetMyConsentFeatureResponse,
} from './get-my-consent.feature'

class GetMyConsentOutput extends createZodDto(
    GetMyConsentFeatureOutputSchema,
) {}

class AcceptMyConsentInput extends createZodDto(
    AcceptMyConsentFeatureInputSchema,
) {}

class AcceptMyConsentOutput extends createZodDto(
    AcceptMyConsentFeatureOutputSchema,
) {}

// The personal-data consent (152-ФЗ ст. 9) as its own act: the blocking
// consent screen reads the edition and records the acceptance. Reachable
// before consent, by definition.
@Controller('me/consent')
@UseGuards(AuthGuard)
@SkipConsentCheck()
export class MyConsentController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetMyConsentOutput })
    async getMyConsent(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            GetMyConsentFeature,
            GetMyConsentFeatureResponse
        >(new GetMyConsentFeature(user.userId))
    }

    @Post()
    @ZodResponse({ type: AcceptMyConsentOutput })
    async acceptMyConsent(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: AcceptMyConsentInput,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return await this.bus.execute<
            AcceptMyConsentFeature,
            AcceptMyConsentFeatureResponse
        >(
            new AcceptMyConsentFeature(
                body,
                user.userId,
                ip ?? null,
                userAgent ?? null,
            ),
        )
    }
}
