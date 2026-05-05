import { Controller, Get, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    Roles,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListRolesFeature,
    ListRolesFeatureOutputSchema,
    ListRolesFeatureResponse,
} from './list-roles.feature'

class ListRolesOutput extends createZodDto(ListRolesFeatureOutputSchema) {}

// Roles are global rather than workspace-scoped (they live in the Role
// table, not WorkspaceMember), but we still mount the endpoint under a
// workspace path so we can gate it with the same guard chain everything
// else uses. Only WORKSPACE_ADMINS hit this — the only place the admin
// UI calls it from is the role-change select on the user detail page.
@Controller('workspaces/:workspaceId/roles')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListRolesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListRolesOutput })
    async listRoles() {
        return await this.bus.execute<
            ListRolesFeature,
            ListRolesFeatureResponse
        >(new ListRolesFeature())
    }
}
