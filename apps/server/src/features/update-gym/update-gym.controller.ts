import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    UpdateGymFeature,
    UpdateGymFeatureInputSchema,
    UpdateGymFeatureOutputSchema,
    UpdateGymFeatureResponse,
} from './update-gym.feature'

class UpdateGymBody extends createZodDto(UpdateGymFeatureInputSchema) {}
class UpdateGymOutput extends createZodDto(UpdateGymFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/gyms')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class UpdateGymController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':gymId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateGymOutput })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Param('gymId') gymId: string,
        @Body() body: UpdateGymBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<UpdateGymFeature, UpdateGymFeatureResponse>(
            new UpdateGymFeature(body, workspaceId, gymId, user.userId),
        )
    }
}
