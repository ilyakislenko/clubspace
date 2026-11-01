import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AllowSuspendedWorkspace } from '../../shared/decorators/allow-suspended-workspace.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMyWorkspaceMembershipFeature,
    GetMyWorkspaceMembershipFeatureOutputSchema,
    GetMyWorkspaceMembershipFeatureResponse,
} from './get-my-workspace-membership.feature'

class GetMyWorkspaceMembershipOutput extends createZodDto(
    GetMyWorkspaceMembershipFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GetMyWorkspaceMembershipController {
    constructor(private bus: FeaturesBus) {}

    @Get('me')
    // The admin's role gates read this; in a suspended club they must still
    // know who is an admin to route them to the billing page.
    @AllowSuspendedWorkspace()
    @ZodResponse({ type: GetMyWorkspaceMembershipOutput })
    async getMyMembership(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyWorkspaceMembershipFeature,
            GetMyWorkspaceMembershipFeatureResponse
        >(
            new GetMyWorkspaceMembershipFeature(
                workspaceId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
