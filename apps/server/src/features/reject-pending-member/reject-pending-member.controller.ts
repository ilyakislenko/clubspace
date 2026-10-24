import { Controller, Param, Post, UseGuards } from '@nestjs/common'
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
    RejectPendingMemberFeature,
    RejectPendingMemberFeatureOutputSchema,
    RejectPendingMemberFeatureResponse,
} from './reject-pending-member.feature'

class RejectPendingMemberOutput extends createZodDto(
    RejectPendingMemberFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class RejectPendingMemberController {
    constructor(private bus: FeaturesBus) {}

    @Post(':userId/reject')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RejectPendingMemberOutput })
    async rejectPendingMember(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RejectPendingMemberFeature,
            RejectPendingMemberFeatureResponse
        >(
            new RejectPendingMemberFeature(
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
