import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, SPORT_LEADS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListRenewalCandidatesFeature,
    ListRenewalCandidatesInputSchema,
    ListRenewalCandidatesOutputSchema,
    type ListRenewalCandidatesFeatureResponse,
} from './list-renewal-candidates.feature'

class ListRenewalCandidatesQuery extends createZodDto(
    ListRenewalCandidatesInputSchema,
) {}
class ListRenewalCandidatesOutput extends createZodDto(
    ListRenewalCandidatesOutputSchema,
) {}

@Controller('workspaces/:workspaceId/renewal-candidates')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListRenewalCandidatesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: ListRenewalCandidatesOutput })
    async list(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListRenewalCandidatesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListRenewalCandidatesFeature,
            ListRenewalCandidatesFeatureResponse
        >(
            new ListRenewalCandidatesFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
