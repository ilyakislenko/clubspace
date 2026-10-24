import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
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
    CreateLadderFeature,
    CreateLadderInputSchema,
    CreateLadderOutputSchema,
    type CreateLadderFeatureResponse,
} from './create-ladder.feature'
import {
    CreateLevelFeature,
    CreateLevelInputSchema,
    CreateLevelOutputSchema,
    type CreateLevelFeatureResponse,
} from './create-level.feature'
import {
    DeleteLadderFeature,
    DeleteLadderOutputSchema,
    type DeleteLadderFeatureResponse,
} from './delete-ladder.feature'
import {
    DeleteLevelFeature,
    type DeleteLevelFeatureResponse,
} from './delete-level.feature'
import {
    ListLaddersFeature,
    ListLaddersInputSchema,
    ListLaddersOutputSchema,
    type ListLaddersFeatureResponse,
} from './list-ladders.feature'
import {
    UpdateLadderFeature,
    UpdateLadderInputSchema,
    UpdateLadderOutputSchema,
    type UpdateLadderFeatureResponse,
} from './update-ladder.feature'
import {
    UpdateLevelFeature,
    UpdateLevelInputSchema,
    UpdateLevelOutputSchema,
    type UpdateLevelFeatureResponse,
} from './update-level.feature'

class CreateLadderInput extends createZodDto(CreateLadderInputSchema) {}
class RankLadderOutputDto extends createZodDto(CreateLadderOutputSchema) {}
class ListLaddersQuery extends createZodDto(ListLaddersInputSchema) {}
class ListLaddersOutput extends createZodDto(ListLaddersOutputSchema) {}
class UpdateLadderInput extends createZodDto(UpdateLadderInputSchema) {}
class UpdateLadderOutput extends createZodDto(UpdateLadderOutputSchema) {}
class DeleteLadderOutput extends createZodDto(DeleteLadderOutputSchema) {}
class CreateLevelInput extends createZodDto(CreateLevelInputSchema) {}
class RankLevelOutputDto extends createZodDto(CreateLevelOutputSchema) {}
class UpdateLevelInput extends createZodDto(UpdateLevelInputSchema) {}
class UpdateLevelOutput extends createZodDto(UpdateLevelOutputSchema) {}

@Controller('workspaces/:workspaceId/rank-ladders')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class RanksController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RankLadderOutputDto })
    async createRankLadder(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateLadderInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CreateLadderFeature, CreateLadderFeatureResponse>(
            new CreateLadderFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get()
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListLaddersOutput })
    async listRankLadders(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListLaddersQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListLaddersFeature, ListLaddersFeatureResponse>(
            new ListLaddersFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':ladderId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateLadderOutput })
    async updateRankLadder(
        @Param('workspaceId') workspaceId: string,
        @Param('ladderId') ladderId: string,
        @Body() body: UpdateLadderInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<UpdateLadderFeature, UpdateLadderFeatureResponse>(
            new UpdateLadderFeature(
                body,
                workspaceId,
                ladderId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':ladderId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DeleteLadderOutput })
    async deleteRankLadder(
        @Param('workspaceId') workspaceId: string,
        @Param('ladderId') ladderId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<DeleteLadderFeature, DeleteLadderFeatureResponse>(
            new DeleteLadderFeature(
                workspaceId,
                ladderId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':ladderId/levels')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: RankLevelOutputDto })
    async createRankLevel(
        @Param('workspaceId') workspaceId: string,
        @Param('ladderId') ladderId: string,
        @Body() body: CreateLevelInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CreateLevelFeature, CreateLevelFeatureResponse>(
            new CreateLevelFeature(
                body,
                workspaceId,
                ladderId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':ladderId/levels/:levelId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateLevelOutput })
    async updateRankLevel(
        @Param('workspaceId') workspaceId: string,
        @Param('ladderId') ladderId: string,
        @Param('levelId') levelId: string,
        @Body() body: UpdateLevelInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<UpdateLevelFeature, UpdateLevelFeatureResponse>(
            new UpdateLevelFeature(
                body,
                workspaceId,
                ladderId,
                levelId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':ladderId/levels/:levelId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: DeleteLadderOutput })
    async deleteRankLevel(
        @Param('workspaceId') workspaceId: string,
        @Param('ladderId') ladderId: string,
        @Param('levelId') levelId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<DeleteLevelFeature, DeleteLevelFeatureResponse>(
            new DeleteLevelFeature(
                workspaceId,
                ladderId,
                levelId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
