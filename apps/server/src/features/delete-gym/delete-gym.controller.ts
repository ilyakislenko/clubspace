import { Controller, Delete, Param, UseGuards } from '@nestjs/common'
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
    DeleteGymFeature,
    DeleteGymFeatureOutputSchema,
    DeleteGymFeatureResponse,
} from './delete-gym.feature'

class DeleteGymOutput extends createZodDto(DeleteGymFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/gyms')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class DeleteGymController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':gymId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DeleteGymOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('gymId') gymId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteGymFeature,
            DeleteGymFeatureResponse
        >(new DeleteGymFeature(workspaceId, gymId, user.userId))
    }
}
