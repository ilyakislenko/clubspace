import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    ConfirmPlatformMfaEnrollmentFeature,
    ConfirmPlatformMfaEnrollmentFeatureResponse,
    ConfirmPlatformMfaEnrollmentInputSchema,
    ConfirmPlatformMfaEnrollmentOutputSchema,
    GetPlatformMfaFeature,
    GetPlatformMfaFeatureResponse,
    GetPlatformMfaOutputSchema,
    StartPlatformMfaEnrollmentFeature,
    StartPlatformMfaEnrollmentFeatureResponse,
    StartPlatformMfaEnrollmentOutputSchema,
} from './platform-mfa.feature'

class GetPlatformMfaOutput extends createZodDto(GetPlatformMfaOutputSchema) {}
class StartPlatformMfaEnrollmentOutput extends createZodDto(
    StartPlatformMfaEnrollmentOutputSchema,
) {}
class ConfirmPlatformMfaEnrollmentInput extends createZodDto(
    ConfirmPlatformMfaEnrollmentInputSchema,
) {}
class ConfirmPlatformMfaEnrollmentOutput extends createZodDto(
    ConfirmPlatformMfaEnrollmentOutputSchema,
) {}

const caller = (user: CurrentUserPayload) => ({
    invokerUserId: user.userId,
    platformAccount: user.isSuperAdmin || user.superAdminMfaMissing === true,
    accessGranted: user.isSuperAdmin,
})

// No SuperAdminGuard: setting up the authenticator is how a super admin gets
// the platform powers that guard asks for. The handlers admit super-admin
// accounts only.
@Controller('platform/mfa')
@UseGuards(AuthGuard)
export class PlatformMfaController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetPlatformMfaOutput })
    async getPlatformMfa(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            GetPlatformMfaFeature,
            GetPlatformMfaFeatureResponse
        >(new GetPlatformMfaFeature(caller(user)))
    }

    @Post('enrollment')
    @ZodResponse({ type: StartPlatformMfaEnrollmentOutput })
    async startPlatformMfaEnrollment(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            StartPlatformMfaEnrollmentFeature,
            StartPlatformMfaEnrollmentFeatureResponse
        >(new StartPlatformMfaEnrollmentFeature(caller(user)))
    }

    @Post('enrollment/confirm')
    @ZodResponse({ type: ConfirmPlatformMfaEnrollmentOutput })
    async confirmPlatformMfaEnrollment(
        @Body() body: ConfirmPlatformMfaEnrollmentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ConfirmPlatformMfaEnrollmentFeature,
            ConfirmPlatformMfaEnrollmentFeatureResponse
        >(new ConfirmPlatformMfaEnrollmentFeature(body, caller(user)))
    }
}
