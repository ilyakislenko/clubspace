import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
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
    InviteWorkspaceMemberFeature,
    InviteWorkspaceMemberFeatureInputSchema,
    InviteWorkspaceMemberFeatureOutputSchema,
    InviteWorkspaceMemberFeatureResponse,
} from './invite-workspace-member.feature'

class InviteWorkspaceMemberInput extends createZodDto(
    InviteWorkspaceMemberFeatureInputSchema,
) {}

class InviteWorkspaceMemberOutput extends createZodDto(
    InviteWorkspaceMemberFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class InviteWorkspaceMemberController {
    constructor(private bus: FeaturesBus) {}

    @Post('invite')
    @Roles(WORKSPACE_ADMINS)
    @Throttle({ default: { ttl: 3_600_000, limit: 100 } })
    @ZodResponse({ type: InviteWorkspaceMemberOutput })
    async inviteWorkspaceMember(
        @Param('workspaceId') workspaceId: string,
        @Body() body: InviteWorkspaceMemberInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            InviteWorkspaceMemberFeature,
            InviteWorkspaceMemberFeatureResponse
        >(
            new InviteWorkspaceMemberFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
