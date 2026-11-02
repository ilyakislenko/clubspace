import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
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
    PlatformDemoClubQuerySchema,
} from './get-platform-demo-club.feature'
import {
    ResetPlatformDemoClubFeature,
    ResetPlatformDemoClubFeatureResponse,
    ResetPlatformDemoClubOutputSchema,
} from './reset-platform-demo-club.feature'

class GetPlatformDemoClubOutput extends createZodDto(GetPlatformDemoClubOutputSchema) {}
class ResetPlatformDemoClubOutput extends createZodDto(ResetPlatformDemoClubOutputSchema) {}
class PlatformDemoClubQuery extends createZodDto(PlatformDemoClubQuerySchema) {}

// The console's «Демо-клубы» cards (docs/demo.md): each demo club's accounts
// and «Сбросить демо» (`?club=academy|ritm`, ACADEMY when omitted).
// SuperAdminGuard is the gate (no club in scope); each handler re-asserts.
@Controller('platform/demo-club')
@UseGuards(AuthGuard, SuperAdminGuard)
export class PlatformDemoClubController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetPlatformDemoClubOutput })
    async getPlatformDemoClub(
        @Query() query: PlatformDemoClubQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetPlatformDemoClubFeature,
            GetPlatformDemoClubFeatureResponse
        >(new GetPlatformDemoClubFeature(user.userId, user.isSuperAdmin, query.club))
    }

    @Post('reset')
    @ZodResponse({ type: ResetPlatformDemoClubOutput })
    async resetPlatformDemoClub(
        @Query() query: PlatformDemoClubQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ResetPlatformDemoClubFeature,
            ResetPlatformDemoClubFeatureResponse
        >(new ResetPlatformDemoClubFeature(user.userId, user.isSuperAdmin, query.club))
    }
}
