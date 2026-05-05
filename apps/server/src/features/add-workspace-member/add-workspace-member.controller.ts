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
    AddWorkspaceMemberFeature,
    AddWorkspaceMemberFeatureInputSchema,
    AddWorkspaceMemberFeatureOutputSchema,
    AddWorkspaceMemberFeatureResponse,
} from './add-workspace-member.feature'

class AddWorkspaceMemberBody extends createZodDto(
    AddWorkspaceMemberFeatureInputSchema,
) {}

class AddWorkspaceMemberOutput extends createZodDto(
    AddWorkspaceMemberFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AddWorkspaceMemberController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: AddWorkspaceMemberOutput })
    async addMember(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AddWorkspaceMemberBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddWorkspaceMemberFeature,
            AddWorkspaceMemberFeatureResponse
        >(new AddWorkspaceMemberFeature(body, workspaceId, user.userId))
    }
}
