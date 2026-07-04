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
    GetMemberRanksFeature,
    GetMemberRanksOutputSchema,
    type GetMemberRanksFeatureResponse,
} from './get-member-ranks.feature'
import {
    PromoteMemberFeature,
    PromoteMemberInputSchema,
    PromoteMemberOutputSchema,
    type PromoteMemberFeatureResponse,
} from './promote-member.feature'

class PromoteMemberInput extends createZodDto(PromoteMemberInputSchema) {}
class PromotionOutputDto extends createZodDto(PromoteMemberOutputSchema) {}
class MemberRanksOutput extends createZodDto(GetMemberRanksOutputSchema) {}

@Controller('workspaces/:workspaceId/members/:userId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class MemberRanksController {
    constructor(private bus: FeaturesBus) {}

    @Post('rank')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: PromotionOutputDto })
    async promoteMember(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Body() body: PromoteMemberInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            PromoteMemberFeature,
            PromoteMemberFeatureResponse
        >(
            new PromoteMemberFeature(
                body,
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('ranks')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: MemberRanksOutput })
    async getMemberRanks(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetMemberRanksFeature,
            GetMemberRanksFeatureResponse
        >(
            new GetMemberRanksFeature(
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
