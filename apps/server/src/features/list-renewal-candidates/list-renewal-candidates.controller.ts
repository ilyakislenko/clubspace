import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListRenewalCandidatesFeature,
    ListRenewalCandidatesOutputSchema,
    type ListRenewalCandidatesFeatureResponse,
} from './list-renewal-candidates.feature'

class ListRenewalCandidatesOutput extends createZodDto(
    ListRenewalCandidatesOutputSchema,
) {}

@Controller('workspaces/:workspaceId/renewal-candidates')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListRenewalCandidatesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListRenewalCandidatesOutput })
    async list(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListRenewalCandidatesFeature,
            ListRenewalCandidatesFeatureResponse
        >(
            new ListRenewalCandidatesFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
