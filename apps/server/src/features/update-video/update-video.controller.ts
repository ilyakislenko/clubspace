import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    UpdateVideoFeature,
    UpdateVideoFeatureInputSchema,
    UpdateVideoFeatureOutputSchema,
    UpdateVideoFeatureResponse,
} from './update-video.feature'

class UpdateVideoInput extends createZodDto(UpdateVideoFeatureInputSchema) {}

class UpdateVideoOutput extends createZodDto(UpdateVideoFeatureOutputSchema) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class UpdateVideoController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':id')
    @ZodResponse({ type: UpdateVideoOutput })
    async updateVideo(
        @Param('id') id: string,
        @Body() input: UpdateVideoInput,
    ) {
        return await this.bus.execute<UpdateVideoFeature, UpdateVideoFeatureResponse>(
            new UpdateVideoFeature(input, id),
        )
    }
}
