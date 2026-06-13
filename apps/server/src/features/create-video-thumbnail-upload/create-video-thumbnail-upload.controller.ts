import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateVideoThumbnailUploadFeature,
    CreateVideoThumbnailUploadFeatureInputSchema,
    CreateVideoThumbnailUploadFeatureOutputSchema,
    CreateVideoThumbnailUploadFeatureResponse,
} from './create-video-thumbnail-upload.feature'

class CreateVideoThumbnailUploadInput extends createZodDto(
    CreateVideoThumbnailUploadFeatureInputSchema,
) {}

class CreateVideoThumbnailUploadOutput extends createZodDto(
    CreateVideoThumbnailUploadFeatureOutputSchema,
) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class CreateVideoThumbnailUploadController {
    constructor(private bus: FeaturesBus) {}

    @Post(':id/thumbnail-upload')
    @ZodResponse({ type: CreateVideoThumbnailUploadOutput })
    async createThumbnailUpload(
        @Param('id') id: string,
        @Body() input: CreateVideoThumbnailUploadInput,
    ) {
        return await this.bus.execute<
            CreateVideoThumbnailUploadFeature,
            CreateVideoThumbnailUploadFeatureResponse
        >(new CreateVideoThumbnailUploadFeature(input, id))
    }
}
