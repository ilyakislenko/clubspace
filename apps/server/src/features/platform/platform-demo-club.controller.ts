import { Controller, Get, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { SuperAdminGuard } from '../../shared/guards/super-admin.guard'
import {
    GetPlatformDemoClubFeature,
    GetPlatformDemoClubFeatureResponse,
    GetPlatformDemoClubOutputSchema,
} from './get-platform-demo-club.feature'
import {
    ResetPlatformDemoClubFeature,
    ResetPlatformDemoClubFeatureResponse,
    ResetPlatformDemoClubOutputSchema,
} from './reset-platform-demo-club.feature'

class GetPlatformDemoClubOutput extends createZodDto(GetPlatformDemoClubOutputSchema) {}
class ResetPlatformDemoClubOutput extends createZodDto(ResetPlatformDemoClubOutputSchema) {}

// The console's «Демо-клуб» card (docs/demo.md): the demo accounts and
// «Сбросить демо». SuperAdminGuard is the gate (no club in scope); each
// handler re-asserts.
@Controller('platform/demo-club')
@UseGuards(AuthGuard, SuperAdminGuard)
export class PlatformDemoClubController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetPlatformDemoClubOutput })
    async getPlatformDemoClub(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            GetPlatformDemoClubFeature,
            GetPlatformDemoClubFeatureResponse
        >(new GetPlatformDemoClubFeature(user.userId, user.isSuperAdmin))
    }

    @Post('reset')
    @ZodResponse({ type: ResetPlatformDemoClubOutput })
    async resetPlatformDemoClub(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            ResetPlatformDemoClubFeature,
            ResetPlatformDemoClubFeatureResponse
        >(new ResetPlatformDemoClubFeature(user.userId, user.isSuperAdmin))
    }
}
