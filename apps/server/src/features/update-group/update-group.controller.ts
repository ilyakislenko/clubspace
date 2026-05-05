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
    UpdateGroupFeature,
    UpdateGroupFeatureInputSchema,
    UpdateGroupFeatureOutputSchema,
    UpdateGroupFeatureResponse,
} from './update-group.feature'

class UpdateGroupBody extends createZodDto(UpdateGroupFeatureInputSchema) {}
class UpdateGroupOutput extends createZodDto(UpdateGroupFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class UpdateGroupController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':groupId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: UpdateGroupOutput })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Body() body: UpdateGroupBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateGroupFeature,
            UpdateGroupFeatureResponse
        >(
            new UpdateGroupFeature(
                body,
                workspaceId,
                groupId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
