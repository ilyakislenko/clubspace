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
    SyncGroupMembersFeature,
    SyncGroupMembersFeatureInputSchema,
    SyncGroupMembersFeatureOutputSchema,
    SyncGroupMembersFeatureResponse,
} from './sync-group-members.feature'

class SyncGroupMembersBody extends createZodDto(
    SyncGroupMembersFeatureInputSchema,
) {}
class SyncGroupMembersOutput extends createZodDto(
    SyncGroupMembersFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class SyncGroupMembersController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':groupId/members')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: SyncGroupMembersOutput })
    async sync(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Body() body: SyncGroupMembersBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SyncGroupMembersFeature,
            SyncGroupMembersFeatureResponse
        >(
            new SyncGroupMembersFeature(
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
