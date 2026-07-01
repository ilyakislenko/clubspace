import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetNotificationPreferencesFeature,
    GetNotificationPreferencesFeatureOutputSchema,
    GetNotificationPreferencesFeatureResponse,
} from './get-notification-preferences.feature'
import {
    UpdateNotificationPreferencesFeature,
    UpdateNotificationPreferencesFeatureInputSchema,
    UpdateNotificationPreferencesFeatureOutputSchema,
    UpdateNotificationPreferencesFeatureResponse,
} from './update-notification-preferences.feature'

class GetNotificationPreferencesOutput extends createZodDto(
    GetNotificationPreferencesFeatureOutputSchema,
) {}

class UpdateNotificationPreferencesInput extends createZodDto(
    UpdateNotificationPreferencesFeatureInputSchema,
) {}

class UpdateNotificationPreferencesOutput extends createZodDto(
    UpdateNotificationPreferencesFeatureOutputSchema,
) {}

// Per-user, category-level notification opt-outs (the mobile Settings toggles).
// Any authenticated user manages their own — no workspace/role scope.
@Controller('me/notification-preferences')
@UseGuards(AuthGuard)
export class NotificationPreferencesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetNotificationPreferencesOutput })
    async get(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            GetNotificationPreferencesFeature,
            GetNotificationPreferencesFeatureResponse
        >(new GetNotificationPreferencesFeature(user.userId))
    }

    @Put()
    @ZodResponse({ type: UpdateNotificationPreferencesOutput })
    async update(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: UpdateNotificationPreferencesInput,
    ) {
        return await this.bus.execute<
            UpdateNotificationPreferencesFeature,
            UpdateNotificationPreferencesFeatureResponse
        >(new UpdateNotificationPreferencesFeature(user.userId, body))
    }
}
