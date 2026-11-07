import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
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
    GetSubtitleCuesFeature,
    GetSubtitleCuesFeatureOutputSchema,
    type GetSubtitleCuesFeatureResponse,
    GetVideoTextStatusFeature,
    GetVideoTextStatusFeatureOutputSchema,
    type GetVideoTextStatusFeatureResponse,
    RegenerateVideoTextFeature,
    RegenerateVideoTextFeatureInputSchema,
    RegenerateVideoTextFeatureOutputSchema,
    type RegenerateVideoTextFeatureResponse,
} from './video-text.feature'

class VideoTextStatusOutput extends createZodDto(GetVideoTextStatusFeatureOutputSchema) {}
class RegenerateVideoTextInput extends createZodDto(RegenerateVideoTextFeatureInputSchema) {}
class RegenerateVideoTextOutput extends createZodDto(RegenerateVideoTextFeatureOutputSchema) {}
class SubtitleCuesOutput extends createZodDto(GetSubtitleCuesFeatureOutputSchema) {}

// Staff's view of what the worker made from a lesson (transcript, automatic
// chapters and subtitles), a subtitle preview, and «Пересоздать».
@Controller('workspaces/:workspaceId/videos/:videoId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class VideoTextController {
    constructor(private bus: FeaturesBus) {}

    @Get('text-status')
    @ZodResponse({ type: VideoTextStatusOutput })
    async getVideoTextStatus(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
    ) {
        return await this.bus.execute<GetVideoTextStatusFeature, GetVideoTextStatusFeatureResponse>(
            new GetVideoTextStatusFeature(workspaceId, videoId),
        )
    }

    @Post('regenerate-text')
    @ZodResponse({ type: RegenerateVideoTextOutput })
    async regenerateVideoText(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Body() body: RegenerateVideoTextInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<RegenerateVideoTextFeature, RegenerateVideoTextFeatureResponse>(
            new RegenerateVideoTextFeature(workspaceId, videoId, body, user.userId),
        )
    }

    @Get('subtitles/:subtitleId/cues')
    @ZodResponse({ type: SubtitleCuesOutput })
    async getSubtitleCues(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Param('subtitleId') subtitleId: string,
    ) {
        return await this.bus.execute<GetSubtitleCuesFeature, GetSubtitleCuesFeatureResponse>(
            new GetSubtitleCuesFeature(workspaceId, videoId, subtitleId),
        )
    }
}
