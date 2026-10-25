import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
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
    GetRankReadinessFeature,
    GetRankReadinessInputSchema,
    GetRankReadinessOutputSchema,
    type GetRankReadinessFeatureResponse,
} from './get-rank-readiness.feature'

class GetRankReadinessQuery extends createZodDto(GetRankReadinessInputSchema) {}
class GetRankReadinessOutput extends createZodDto(GetRankReadinessOutputSchema) {}

@Controller('workspaces/:workspaceId/rank-readiness')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class RankReadinessController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: GetRankReadinessOutput })
    async getRankReadiness(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetRankReadinessQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetRankReadinessFeature,
            GetRankReadinessFeatureResponse
        >(
            new GetRankReadinessFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
