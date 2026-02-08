import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetVideoFeature,
    GetVideoFeatureInputSchema,
    GetVideoFeatureOutputSchema,
    GetVideoFeatureResponse,
} from './get-video.feature'

class GetVideoQuery extends createZodDto(GetVideoFeatureInputSchema) {}

class GetVideoOutput extends createZodDto(GetVideoFeatureOutputSchema) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GetVideoController {
    constructor(private bus: FeaturesBus) {}

    @Get(':id')
    @ZodResponse({ type: GetVideoOutput })
    async getVideo(@Param('id') id: string, @Query() query: GetVideoQuery) {
        return await this.bus.execute<GetVideoFeature, GetVideoFeatureResponse>(
            new GetVideoFeature(query, id),
        )
    }
}
