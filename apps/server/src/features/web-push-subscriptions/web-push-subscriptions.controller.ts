import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
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
    GetWebPushConfigFeature,
    GetWebPushConfigFeatureResponse,
    SubscribeWebPushFeature,
    SubscribeWebPushFeatureResponse,
    SubscribeWebPushInputSchema,
    SubscribeWebPushOutputSchema,
    UnsubscribeWebPushFeature,
    UnsubscribeWebPushFeatureResponse,
    UnsubscribeWebPushInputSchema,
    UnsubscribeWebPushOutputSchema,
    WebPushConfigOutputSchema,
} from './web-push-subscriptions.feature'

class SubscribeWebPushInput extends createZodDto(SubscribeWebPushInputSchema) {}
class SubscribeWebPushOutput extends createZodDto(SubscribeWebPushOutputSchema) {}
class UnsubscribeWebPushInput extends createZodDto(UnsubscribeWebPushInputSchema) {}
class UnsubscribeWebPushOutput extends createZodDto(UnsubscribeWebPushOutputSchema) {}
class WebPushConfigOutput extends createZodDto(WebPushConfigOutputSchema) {}

// Browser (PWA) push subscriptions of the signed-in user. The native app's
// Expo tokens live next door in /me/firebase-devices.
@Controller('me/web-push-subscriptions')
@UseGuards(AuthGuard)
export class WebPushSubscriptionsController {
    constructor(private bus: FeaturesBus) {}

    @Get('config')
    @ZodResponse({ type: WebPushConfigOutput })
    async getWebPushConfig() {
        return await this.bus.execute<
            GetWebPushConfigFeature,
            GetWebPushConfigFeatureResponse
        >(new GetWebPushConfigFeature())
    }

    @Post()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: SubscribeWebPushOutput })
    async subscribeWebPush(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: SubscribeWebPushInput,
    ) {
        return await this.bus.execute<
            SubscribeWebPushFeature,
            SubscribeWebPushFeatureResponse
        >(new SubscribeWebPushFeature(user.userId, body))
    }

    @Delete()
    // Signing out from the consent screen must still drop this browser's
    // subscription, or the next person on it gets this user's notifications.
    @SkipConsentCheck()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: UnsubscribeWebPushOutput })
    async unsubscribeWebPush(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: UnsubscribeWebPushInput,
    ) {
        return await this.bus.execute<
            UnsubscribeWebPushFeature,
            UnsubscribeWebPushFeatureResponse
        >(new UnsubscribeWebPushFeature(user.userId, body.endpoint))
    }
}
