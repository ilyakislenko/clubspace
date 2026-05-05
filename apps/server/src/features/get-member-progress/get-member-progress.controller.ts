import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMemberProgressFeature,
    GetMemberProgressFeatureOutputSchema,
    GetMemberProgressFeatureResponse,
} from './get-member-progress.feature'

class GetMemberProgressOutput extends createZodDto(
    GetMemberProgressFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members/:userId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetMemberProgressController {
    constructor(private bus: FeaturesBus) {}

    @Get('progress')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetMemberProgressOutput })
    async getProgress(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMemberProgressFeature,
            GetMemberProgressFeatureResponse
        >(
            new GetMemberProgressFeature(
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
