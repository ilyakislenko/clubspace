import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    CreateSelfServeWorkspaceFeature,
    CreateSelfServeWorkspaceFeatureResponse,
    CreateSelfServeWorkspaceInputSchema,
    CreateSelfServeWorkspaceOutputSchema,
} from './create-self-serve-workspace.feature'
import {
    GetSelfServeConfigFeature,
    GetSelfServeConfigFeatureResponse,
    GetSelfServeConfigOutputSchema,
} from './get-self-serve-config.feature'

class CreateSelfServeWorkspaceInputDto extends createZodDto(
    CreateSelfServeWorkspaceInputSchema,
) {}
class CreateSelfServeWorkspaceOutput extends createZodDto(
    CreateSelfServeWorkspaceOutputSchema,
) {}
class GetSelfServeConfigOutput extends createZodDto(
    GetSelfServeConfigOutputSchema,
) {}

// Self-serve club signup. Not workspace-scoped (the club does not exist yet),
// so the AuthGuard alone gates creation; the config read is public.
@Controller('self-serve')
export class SelfServeController {
    constructor(private bus: FeaturesBus) {}

    @Get('config')
    @ZodResponse({ type: GetSelfServeConfigOutput })
    async getSelfServeConfig() {
        return await this.bus.execute<
            GetSelfServeConfigFeature,
            GetSelfServeConfigFeatureResponse
        >(new GetSelfServeConfigFeature())
    }

    // Per account once signed in (ClubThrottlerGuard): a handful of attempts
    // an hour is plenty for a person and nothing for a script.
    @Post('workspaces')
    @UseGuards(AuthGuard)
    @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
    @ZodResponse({ type: CreateSelfServeWorkspaceOutput })
    async createSelfServeWorkspace(
        @Body() body: CreateSelfServeWorkspaceInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateSelfServeWorkspaceFeature,
            CreateSelfServeWorkspaceFeatureResponse
        >(new CreateSelfServeWorkspaceFeature(body, user.userId))
    }
}
