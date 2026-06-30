import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetMyNotificationsFeature,
    GetMyNotificationsFeatureInputSchema,
    GetMyNotificationsFeatureOutputSchema,
    GetMyNotificationsFeatureResponse,
} from './get-my-notifications.feature'
import {
    MarkNotificationsSeenFeature,
    MarkNotificationsSeenFeatureInputSchema,
    MarkNotificationsSeenFeatureOutputSchema,
    MarkNotificationsSeenFeatureResponse,
} from './mark-notifications-seen.feature'

class GetMyNotificationsQuery extends createZodDto(
    GetMyNotificationsFeatureInputSchema,
) {}

class GetMyNotificationsOutput extends createZodDto(
    GetMyNotificationsFeatureOutputSchema,
) {}

class MarkNotificationsSeenInput extends createZodDto(
    MarkNotificationsSeenFeatureInputSchema,
) {}

class MarkNotificationsSeenOutput extends createZodDto(
    MarkNotificationsSeenFeatureOutputSchema,
) {}

// In-app notification inbox for the current user. Any authenticated user can
// read and acknowledge their own notifications (no workspace/role scope —
// notifications are addressed to a userId).
@Controller('me/notifications')
@UseGuards(AuthGuard)
export class NotificationsInboxController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetMyNotificationsOutput })
    async list(
        @CurrentUser() user: CurrentUserPayload,
        @Query() query: GetMyNotificationsQuery,
    ) {
        return await this.bus.execute<
            GetMyNotificationsFeature,
            GetMyNotificationsFeatureResponse
        >(new GetMyNotificationsFeature(user.userId, query))
    }

    @Post('seen')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: MarkNotificationsSeenOutput })
    async markSeen(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: MarkNotificationsSeenInput,
    ) {
        return await this.bus.execute<
            MarkNotificationsSeenFeature,
            MarkNotificationsSeenFeatureResponse
        >(new MarkNotificationsSeenFeature(user.userId, body))
    }
}
