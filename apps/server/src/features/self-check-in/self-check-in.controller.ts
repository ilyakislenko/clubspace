import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    SelfCheckInPreviewFeature,
    SelfCheckInPreviewInputSchema,
    SelfCheckInPreviewOutputSchema,
    type SelfCheckInPreviewFeatureResponse,
} from './self-check-in-preview.feature'
import {
    SelfCheckInFeature,
    SelfCheckInInputSchema,
    SelfCheckInOutputSchema,
    SelfCheckInFeatureResponse,
} from './self-check-in.feature'

class SelfCheckInBody extends createZodDto(SelfCheckInInputSchema) {}
class SelfCheckInOutput extends createZodDto(SelfCheckInOutputSchema) {}
class SelfCheckInPreviewInputDto extends createZodDto(
    SelfCheckInPreviewInputSchema,
) {}
class SelfCheckInPreviewOutputDto extends createZodDto(
    SelfCheckInPreviewOutputSchema,
) {}

// Any active member can self-check-in with the code the coach shows — no
// @Roles (this is a member action, not a staff one).
@Controller('workspaces/:workspaceId/attendance')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class SelfCheckInController {
    constructor(private bus: FeaturesBus) {}

    @Post('check-in')
    @ZodResponse({ type: SelfCheckInOutput })
    async checkIn(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SelfCheckInBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SelfCheckInFeature,
            SelfCheckInFeatureResponse
        >(new SelfCheckInFeature(body, workspaceId, user.userId))
    }

    // What the check-in would be spent on, before the member confirms.
    @Post('check-in/preview')
    @ZodResponse({ type: SelfCheckInPreviewOutputDto })
    async previewSelfCheckIn(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SelfCheckInPreviewInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SelfCheckInPreviewFeature,
            SelfCheckInPreviewFeatureResponse
        >(new SelfCheckInPreviewFeature(body, workspaceId, user.userId))
    }
}
