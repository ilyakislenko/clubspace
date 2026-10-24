import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
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
    GetLadderRosterFeature,
    GetLadderRosterOutputSchema,
    type GetLadderRosterFeatureResponse,
} from './get-ladder-roster.feature'
import {
    PromoteMembersFeature,
    PromoteMembersInputSchema,
    PromoteMembersOutputSchema,
    type PromoteMembersFeatureResponse,
} from './promote-members.feature'

class LadderRosterOutput extends createZodDto(GetLadderRosterOutputSchema) {}
class PromoteMembersInput extends createZodDto(PromoteMembersInputSchema) {}
class PromoteMembersOutput extends createZodDto(PromoteMembersOutputSchema) {}

@Controller('workspaces/:workspaceId/rank-ladders/:ladderId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class LadderRosterController {
    constructor(private bus: FeaturesBus) {}

    @Get('roster')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: LadderRosterOutput })
    async getLadderRoster(
        @Param('workspaceId') workspaceId: string,
        @Param('ladderId') ladderId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetLadderRosterFeature,
            GetLadderRosterFeatureResponse
        >(
            new GetLadderRosterFeature(
                workspaceId,
                ladderId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('promotions')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: PromoteMembersOutput })
    async promoteMembers(
        @Param('workspaceId') workspaceId: string,
        @Param('ladderId') ladderId: string,
        @Body() body: PromoteMembersInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            PromoteMembersFeature,
            PromoteMembersFeatureResponse
        >(
            new PromoteMembersFeature(
                body,
                workspaceId,
                ladderId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
