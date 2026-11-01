import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common'
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
    AssignDirectionManagerFeature,
    type AssignDirectionManagerFeatureResponse,
    AssignDirectionManagerInputSchema,
    DirectionManagerOutputSchema,
    ListDirectionManagersFeature,
    type ListDirectionManagersFeatureResponse,
    ListDirectionManagersOutputSchema,
    RemoveDirectionManagerFeature,
    type RemoveDirectionManagerFeatureResponse,
    RemoveDirectionManagerOutputSchema,
} from './direction-managers.feature'

class AssignDirectionManagerInput extends createZodDto(
    AssignDirectionManagerInputSchema,
) {}
class DirectionManagerOutputDto extends createZodDto(
    DirectionManagerOutputSchema,
) {}
class ListDirectionManagersOutput extends createZodDto(
    ListDirectionManagersOutputSchema,
) {}
class RemoveDirectionManagerOutput extends createZodDto(
    RemoveDirectionManagerOutputSchema,
) {}

@Controller('workspaces/:workspaceId/direction-managers')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class DirectionManagersController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListDirectionManagersOutput })
    async listDirectionManagers(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListDirectionManagersFeature,
            ListDirectionManagersFeatureResponse
        >(
            new ListDirectionManagersFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DirectionManagerOutputDto })
    async assignDirectionManager(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AssignDirectionManagerInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            AssignDirectionManagerFeature,
            AssignDirectionManagerFeatureResponse
        >(
            new AssignDirectionManagerFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':managerId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RemoveDirectionManagerOutput })
    async removeDirectionManager(
        @Param('workspaceId') workspaceId: string,
        @Param('managerId', ParseUUIDPipe) managerId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            RemoveDirectionManagerFeature,
            RemoveDirectionManagerFeatureResponse
        >(
            new RemoveDirectionManagerFeature(
                workspaceId,
                managerId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
