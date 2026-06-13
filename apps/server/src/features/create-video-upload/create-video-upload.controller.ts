import { Body, Controller, Post, UseGuards } from '@nestjs/common'
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
    CreateVideoUploadFeature,
    CreateVideoUploadFeatureInputSchema,
    CreateVideoUploadFeatureOutputSchema,
    CreateVideoUploadFeatureResponse,
} from './create-video-upload.feature'

class CreateVideoUploadInput extends createZodDto(
    CreateVideoUploadFeatureInputSchema,
) {}

class CreateVideoUploadOutput extends createZodDto(
    CreateVideoUploadFeatureOutputSchema,
) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class CreateVideoUploadController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: CreateVideoUploadOutput })
    async createUpload(
        @Body() input: CreateVideoUploadInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateVideoUploadFeature,
            CreateVideoUploadFeatureResponse
        >(new CreateVideoUploadFeature(input, user.userId))
    }
}
