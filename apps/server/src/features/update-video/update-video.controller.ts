import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
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
    UpdateVideoFeature,
    UpdateVideoFeatureInputSchema,
    UpdateVideoFeatureOutputSchema,
    UpdateVideoFeatureResponse,
} from './update-video.feature'

class UpdateVideoInput extends createZodDto(UpdateVideoFeatureInputSchema) {}

class UpdateVideoOutput extends createZodDto(UpdateVideoFeatureOutputSchema) {}

@Controller('admin/videos')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class UpdateVideoController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':id')
    @ZodResponse({ type: UpdateVideoOutput })
    async updateVideo(
        @Param('id') id: string,
        @Body() input: UpdateVideoInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<UpdateVideoFeature, UpdateVideoFeatureResponse>(
            new UpdateVideoFeature(input, id, user.userId),
        )
    }
}
