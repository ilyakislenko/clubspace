import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
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
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class CreateVideoUploadController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: CreateVideoUploadOutput })
    async createUpload(@Body() input: CreateVideoUploadInput) {
        return await this.bus.execute<
            CreateVideoUploadFeature,
            CreateVideoUploadFeatureResponse
        >(new CreateVideoUploadFeature(input))
    }
}
