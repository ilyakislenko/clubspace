import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    Roles,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AddWorkspaceDependentFeature,
    type AddWorkspaceDependentFeatureResponse,
    AddWorkspaceDependentInputSchema,
    AddWorkspaceDependentOutputSchema,
} from './add-workspace-dependent.feature'

class AddWorkspaceDependentInput extends createZodDto(
    AddWorkspaceDependentInputSchema,
) {}
class AddWorkspaceDependentOutput extends createZodDto(
    AddWorkspaceDependentOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members/dependents')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AddWorkspaceDependentController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: AddWorkspaceDependentOutput })
    async addWorkspaceDependent(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AddWorkspaceDependentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddWorkspaceDependentFeature,
            AddWorkspaceDependentFeatureResponse
        >(
            new AddWorkspaceDependentFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
