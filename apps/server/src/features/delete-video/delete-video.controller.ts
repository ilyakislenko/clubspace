import { Controller, Delete, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    DeleteVideoFeature,
    DeleteVideoFeatureInputSchema,
    DeleteVideoFeatureOutputSchema,
    DeleteVideoFeatureResponse,
} from './delete-video.feature'

class DeleteVideoQuery extends createZodDto(DeleteVideoFeatureInputSchema) {}

class DeleteVideoOutput extends createZodDto(DeleteVideoFeatureOutputSchema) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class DeleteVideoController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':id')
    @ZodResponse({ type: DeleteVideoOutput })
    async deleteVideo(
        @Param('id') id: string,
        @Query() query: DeleteVideoQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<DeleteVideoFeature, DeleteVideoFeatureResponse>(
            new DeleteVideoFeature(query, id, user.userId),
        )
    }
}
