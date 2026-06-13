import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CompleteVideoUploadFeature,
    CompleteVideoUploadFeatureInputSchema,
    CompleteVideoUploadFeatureOutputSchema,
    CompleteVideoUploadFeatureResponse,
} from './complete-video-upload.feature'

class CompleteVideoUploadInput extends createZodDto(
    CompleteVideoUploadFeatureInputSchema,
) {}

class CompleteVideoUploadOutput extends createZodDto(
    CompleteVideoUploadFeatureOutputSchema,
) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class CompleteVideoUploadController {
    constructor(private bus: FeaturesBus) {}

    @Post(':id/complete-upload')
    @ZodResponse({ type: CompleteVideoUploadOutput })
    async completeUpload(
        @Param('id') id: string,
        @Body() input: CompleteVideoUploadInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CompleteVideoUploadFeature,
            CompleteVideoUploadFeatureResponse
        >(new CompleteVideoUploadFeature(input, id, user.userId))
    }
}
