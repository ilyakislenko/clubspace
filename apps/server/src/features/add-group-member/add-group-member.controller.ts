import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
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
    AddGroupMemberFeature,
    AddGroupMemberFeatureInputSchema,
    AddGroupMemberFeatureOutputSchema,
    AddGroupMemberFeatureResponse,
} from './add-group-member.feature'

class AddGroupMemberBody extends createZodDto(
    AddGroupMemberFeatureInputSchema,
) {}
class AddGroupMemberOutput extends createZodDto(
    AddGroupMemberFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AddGroupMemberController {
    constructor(private bus: FeaturesBus) {}

    @Post(':groupId/members')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AddGroupMemberOutput })
    async add(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Body() body: AddGroupMemberBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddGroupMemberFeature,
            AddGroupMemberFeatureResponse
        >(
            new AddGroupMemberFeature(
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
