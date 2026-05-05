import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
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
    CreateGroupFeature,
    CreateGroupFeatureInputSchema,
    CreateGroupFeatureOutputSchema,
    CreateGroupFeatureResponse,
} from './create-group.feature'

class CreateGroupBody extends createZodDto(CreateGroupFeatureInputSchema) {}
class CreateGroupOutput extends createZodDto(CreateGroupFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class CreateGroupController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: CreateGroupOutput })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateGroupBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateGroupFeature,
            CreateGroupFeatureResponse
        >(
            new CreateGroupFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
