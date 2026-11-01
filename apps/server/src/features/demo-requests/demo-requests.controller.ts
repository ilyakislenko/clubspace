import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { SuperAdminGuard } from '../../shared/guards/super-admin.guard'
import {
    CreateDemoRequestFeature,
    CreateDemoRequestFeatureResponse,
    CreateDemoRequestInputSchema,
    CreateDemoRequestOutputSchema,
    ListPlatformDemoRequestsFeature,
    ListPlatformDemoRequestsFeatureResponse,
    ListPlatformDemoRequestsOutputSchema,
} from './demo-requests.feature'

class CreateDemoRequestInputDto extends createZodDto(
    CreateDemoRequestInputSchema,
) {}
class CreateDemoRequestOutput extends createZodDto(
    CreateDemoRequestOutputSchema,
) {}
class ListPlatformDemoRequestsOutput extends createZodDto(
    ListPlatformDemoRequestsOutputSchema,
) {}

// The landing's «Показать демо» form. Unauthenticated, so per IP and tight:
// a club asks once or twice, a script hits the wall at the sixth try an hour.
export const DEMO_REQUEST_THROTTLE = {
    default: { ttl: 3_600_000, limit: 5, getTracker: trackByClientIp },
}

@Controller('public/demo-requests')
@ApiTags('Public')
export class DemoRequestsController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Throttle(DEMO_REQUEST_THROTTLE)
    @ZodResponse({ type: CreateDemoRequestOutput })
    async createDemoRequest(@Body() body: CreateDemoRequestInputDto) {
        return await this.bus.execute<
            CreateDemoRequestFeature,
            CreateDemoRequestFeatureResponse
        >(new CreateDemoRequestFeature(body))
    }
}

// The console's list. SuperAdminGuard is the gate (no club in scope); the
// handler re-asserts.
@Controller('platform/demo-requests')
@UseGuards(AuthGuard, SuperAdminGuard)
export class PlatformDemoRequestsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListPlatformDemoRequestsOutput })
    async listPlatformDemoRequests(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            ListPlatformDemoRequestsFeature,
            ListPlatformDemoRequestsFeatureResponse
        >(new ListPlatformDemoRequestsFeature(user.userId, user.isSuperAdmin))
    }
}
