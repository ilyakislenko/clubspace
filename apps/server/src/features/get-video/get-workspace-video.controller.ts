import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetVideoFeature,
    GetVideoFeatureOutputSchema,
    GetVideoFeatureResponse,
} from './get-video.feature'

class GetWorkspaceVideoOutput extends createZodDto(
    GetVideoFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GetWorkspaceVideoController {
    constructor(private bus: FeaturesBus) {}

    @Get(':videoId')
    @ZodResponse({ type: GetWorkspaceVideoOutput })
    async getVideo(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
    ) {
        return await this.bus.execute<GetVideoFeature, GetVideoFeatureResponse>(
            new GetVideoFeature({ workspaceId }, videoId),
        )
    }
}
