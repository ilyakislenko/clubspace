import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    STAFF_ROLES,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetWorkspaceInviteFeature,
    GetWorkspaceInviteFeatureOutputSchema,
    type GetWorkspaceInviteFeatureResponse,
} from './get-workspace-invite.feature'
import {
    RotateWorkspaceJoinCodeFeature,
    RotateWorkspaceJoinCodeFeatureOutputSchema,
    type RotateWorkspaceJoinCodeFeatureResponse,
} from './rotate-workspace-join-code.feature'

class GetWorkspaceInviteOutput extends createZodDto(
    GetWorkspaceInviteFeatureOutputSchema,
) {}
class RotateWorkspaceJoinCodeOutput extends createZodDto(
    RotateWorkspaceJoinCodeFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/invite')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class WorkspaceInviteController {
    constructor(private bus: FeaturesBus) {}

    // Staff read: a coach shows the code / QR on their phone.
    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetWorkspaceInviteOutput })
    async getWorkspaceInvite(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetWorkspaceInviteFeature,
            GetWorkspaceInviteFeatureResponse
        >(
            new GetWorkspaceInviteFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('rotate-code')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RotateWorkspaceJoinCodeOutput })
    async rotateWorkspaceJoinCode(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RotateWorkspaceJoinCodeFeature,
            RotateWorkspaceJoinCodeFeatureResponse
        >(
            new RotateWorkspaceJoinCodeFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
