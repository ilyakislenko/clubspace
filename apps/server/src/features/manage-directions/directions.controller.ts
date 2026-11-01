import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
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
    CreateDirectionFeature,
    CreateDirectionInputSchema,
    CreateDirectionOutputSchema,
    type CreateDirectionFeatureResponse,
} from './create-direction.feature'
import {
    DeleteDirectionFeature,
    DeleteDirectionOutputSchema,
    type DeleteDirectionFeatureResponse,
} from './delete-direction.feature'
import {
    ListDirectionsFeature,
    ListDirectionsOutputSchema,
    type ListDirectionsFeatureResponse,
} from './list-directions.feature'
import {
    UpdateDirectionFeature,
    UpdateDirectionInputSchema,
    type UpdateDirectionFeatureResponse,
} from './update-direction.feature'

class CreateDirectionInput extends createZodDto(CreateDirectionInputSchema) {}
class UpdateDirectionInput extends createZodDto(UpdateDirectionInputSchema) {}
class DirectionOutputDto extends createZodDto(CreateDirectionOutputSchema) {}
class ListDirectionsOutput extends createZodDto(ListDirectionsOutputSchema) {}
class DeleteDirectionOutput extends createZodDto(DeleteDirectionOutputSchema) {}

@Controller('workspaces/:workspaceId/directions')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class DirectionsController {
    constructor(private bus: FeaturesBus) {}

    // Any member: the app's direction tabs/filters and «мои направления».
    @Get()
    @ZodResponse({ type: ListDirectionsOutput })
    async listDirections(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListDirectionsFeature,
            ListDirectionsFeatureResponse
        >(
            new ListDirectionsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DirectionOutputDto })
    async createDirection(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateDirectionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateDirectionFeature,
            CreateDirectionFeatureResponse
        >(
            new CreateDirectionFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':directionId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DirectionOutputDto })
    async updateDirection(
        @Param('workspaceId') workspaceId: string,
        @Param('directionId', ParseUUIDPipe) directionId: string,
        @Body() body: UpdateDirectionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateDirectionFeature,
            UpdateDirectionFeatureResponse
        >(
            new UpdateDirectionFeature(
                body,
                workspaceId,
                directionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':directionId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DeleteDirectionOutput })
    async deleteDirection(
        @Param('workspaceId') workspaceId: string,
        @Param('directionId', ParseUUIDPipe) directionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteDirectionFeature,
            DeleteDirectionFeatureResponse
        >(
            new DeleteDirectionFeature(
                workspaceId,
                directionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
