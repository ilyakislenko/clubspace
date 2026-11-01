import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { SuperAdminGuard } from '../../shared/guards/super-admin.guard'
import {
    ListPlatformOnboardingRequestsFeature,
    ListPlatformOnboardingRequestsFeatureResponse,
    ListPlatformOnboardingRequestsInputSchema,
    ListPlatformOnboardingRequestsOutputSchema,
    UpdatePlatformOnboardingRequestFeature,
    UpdatePlatformOnboardingRequestFeatureResponse,
    UpdatePlatformOnboardingRequestInputSchema,
    UpdatePlatformOnboardingRequestOutputSchema,
} from './onboarding-help.feature'

class ListPlatformOnboardingRequestsQueryDto extends createZodDto(
    ListPlatformOnboardingRequestsInputSchema,
) {}
class ListPlatformOnboardingRequestsOutput extends createZodDto(
    ListPlatformOnboardingRequestsOutputSchema,
) {}
class UpdatePlatformOnboardingRequestInputDto extends createZodDto(
    UpdatePlatformOnboardingRequestInputSchema,
) {}
class UpdatePlatformOnboardingRequestOutput extends createZodDto(
    UpdatePlatformOnboardingRequestOutputSchema,
) {}

// The platform console's «помощь с подключением» queue. SuperAdminGuard is
// the gate (no club in scope); each handler re-asserts.
@Controller('platform/onboarding-requests')
@UseGuards(AuthGuard, SuperAdminGuard)
export class PlatformOnboardingHelpController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListPlatformOnboardingRequestsOutput })
    async listPlatformOnboardingRequests(
        @Query() query: ListPlatformOnboardingRequestsQueryDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPlatformOnboardingRequestsFeature,
            ListPlatformOnboardingRequestsFeatureResponse
        >(new ListPlatformOnboardingRequestsFeature(query, user.userId, user.isSuperAdmin))
    }

    @Post(':requestId')
    @ZodResponse({ type: UpdatePlatformOnboardingRequestOutput })
    async updatePlatformOnboardingRequest(
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() body: UpdatePlatformOnboardingRequestInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlatformOnboardingRequestFeature,
            UpdatePlatformOnboardingRequestFeatureResponse
        >(
            new UpdatePlatformOnboardingRequestFeature(
                requestId,
                body,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
