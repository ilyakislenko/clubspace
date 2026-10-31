import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import { GetVideoFeatureOutputSchema } from './get-video.feature'
import {
    GetWorkspaceVideoFeature,
    GetWorkspaceVideoFeatureResponse,
} from './get-workspace-video.feature'

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
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetWorkspaceVideoFeature,
            GetWorkspaceVideoFeatureResponse
        >(new GetWorkspaceVideoFeature(workspaceId, videoId, user.userId))
    }
}
