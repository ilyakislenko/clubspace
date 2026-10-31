import {
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards,
} from '@nestjs/common'
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
    ListWorkspaceInvitationsFeature,
    ListWorkspaceInvitationsOutputSchema,
    type ListWorkspaceInvitationsFeatureResponse,
} from './list-workspace-invitations.feature'
import {
    RevokeWorkspaceInvitationFeature,
    RevokeWorkspaceInvitationOutputSchema,
    type RevokeWorkspaceInvitationFeatureResponse,
} from './revoke-workspace-invitation.feature'

class ListWorkspaceInvitationsOutput extends createZodDto(
    ListWorkspaceInvitationsOutputSchema,
) {}
class RevokeWorkspaceInvitationOutput extends createZodDto(
    RevokeWorkspaceInvitationOutputSchema,
) {}

@Controller('workspaces/:workspaceId/invitations')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class WorkspaceInvitationsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListWorkspaceInvitationsOutput })
    async listWorkspaceInvitations(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListWorkspaceInvitationsFeature,
            ListWorkspaceInvitationsFeatureResponse
        >(
            new ListWorkspaceInvitationsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':invitationId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RevokeWorkspaceInvitationOutput })
    async revokeWorkspaceInvitation(
        @Param('workspaceId') workspaceId: string,
        @Param('invitationId', ParseUUIDPipe) invitationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RevokeWorkspaceInvitationFeature,
            RevokeWorkspaceInvitationFeatureResponse
        >(
            new RevokeWorkspaceInvitationFeature(
                invitationId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
