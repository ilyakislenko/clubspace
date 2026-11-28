import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { RequestWorkspaceId } from '../../shared/decorators/request-workspace-id.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AbortVideoUploadFeature,
    AbortVideoUploadFeatureInputSchema,
    AbortVideoUploadFeatureOutputSchema,
    AbortVideoUploadFeatureResponse,
} from './abort-video-upload.feature'

class AbortVideoUploadInput extends createZodDto(
    AbortVideoUploadFeatureInputSchema,
) {}

class AbortVideoUploadOutput extends createZodDto(
    AbortVideoUploadFeatureOutputSchema,
) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class AbortVideoUploadController {
    constructor(private bus: FeaturesBus) {}

    @Post(':id/abort-upload')
    @ZodResponse({ type: AbortVideoUploadOutput })
    async abortVideoUpload(
        @Param('id') id: string,
        // Declares the body contract; the value is read via the resolver.
        @Body() _input: AbortVideoUploadInput,
        @RequestWorkspaceId() workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AbortVideoUploadFeature,
            AbortVideoUploadFeatureResponse
        >(new AbortVideoUploadFeature(workspaceId, id, user.userId))
    }
}
