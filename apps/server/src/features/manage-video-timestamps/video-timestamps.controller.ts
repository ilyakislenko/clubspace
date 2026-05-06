import {
    Body,
    Controller,
    Delete,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateVideoTimestampFeature,
    CreateVideoTimestampFeatureInputSchema,
    VideoTimestampOutputSchema,
    type VideoTimestampResponse,
} from './create-video-timestamp.feature'
import {
    DeleteVideoTimestampFeature,
    DeleteVideoTimestampFeatureOutputSchema,
    type DeleteVideoTimestampFeatureResponse,
} from './delete-video-timestamp.feature'
import {
    UpdateVideoTimestampFeature,
    UpdateVideoTimestampFeatureInputSchema,
} from './update-video-timestamp.feature'

class CreateVideoTimestampInput extends createZodDto(
    CreateVideoTimestampFeatureInputSchema,
) {}

class UpdateVideoTimestampInput extends createZodDto(
    UpdateVideoTimestampFeatureInputSchema,
) {}

class VideoTimestampOutput extends createZodDto(VideoTimestampOutputSchema) {}

class DeleteVideoTimestampOutput extends createZodDto(
    DeleteVideoTimestampFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/videos/:videoId/timestamps')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class VideoTimestampsController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: VideoTimestampOutput })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Body() body: CreateVideoTimestampInput,
    ) {
        return await this.bus.execute<
            CreateVideoTimestampFeature,
            VideoTimestampResponse
        >(new CreateVideoTimestampFeature(body, workspaceId, videoId))
    }

    @Patch(':timestampId')
    @ZodResponse({ type: VideoTimestampOutput })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Param('timestampId') timestampId: string,
        @Body() body: UpdateVideoTimestampInput,
    ) {
        return await this.bus.execute<
            UpdateVideoTimestampFeature,
            VideoTimestampResponse
        >(
            new UpdateVideoTimestampFeature(
                body,
                workspaceId,
                videoId,
                timestampId,
            ),
        )
    }

    @Delete(':timestampId')
    @ZodResponse({ type: DeleteVideoTimestampOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('videoId') videoId: string,
        @Param('timestampId') timestampId: string,
    ) {
        return await this.bus.execute<
            DeleteVideoTimestampFeature,
            DeleteVideoTimestampFeatureResponse
        >(new DeleteVideoTimestampFeature(workspaceId, videoId, timestampId))
    }
}
