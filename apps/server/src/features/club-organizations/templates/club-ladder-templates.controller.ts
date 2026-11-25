import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { RoleGuard } from '../../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../../shared/guards/workspace-member.guard'
import {
    ListAdoptableLadderTemplatesFeature,
    ListAdoptableLadderTemplatesOutputSchema,
    type ListAdoptableLadderTemplatesFeatureResponse,
} from './list-adoptable-ladder-templates.feature'

class ListAdoptableLadderTemplatesOutput extends createZodDto(
    ListAdoptableLadderTemplatesOutputSchema,
) {}

@Controller('workspaces/:workspaceId/organization-ladder-templates')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubLadderTemplatesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListAdoptableLadderTemplatesOutput })
    async listAdoptableLadderTemplates(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListAdoptableLadderTemplatesFeature,
            ListAdoptableLadderTemplatesFeatureResponse
        >(
            new ListAdoptableLadderTemplatesFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
