import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMemberAchievementsFeature,
    GetMemberAchievementsFeatureResponse,
    GetMemberAchievementsOutputSchema,
} from './get-member-achievements.feature'

class MemberAchievementsOutput extends createZodDto(
    GetMemberAchievementsOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members/:userId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetMemberAchievementsController {
    constructor(private bus: FeaturesBus) {}

    @Get('achievements')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: MemberAchievementsOutput })
    async getMemberAchievements(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
    ) {
        return this.bus.execute<
            GetMemberAchievementsFeature,
            GetMemberAchievementsFeatureResponse
        >(new GetMemberAchievementsFeature(workspaceId, userId))
    }
}
