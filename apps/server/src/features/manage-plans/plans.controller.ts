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
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreatePlanFeature,
    CreatePlanInputSchema,
    CreatePlanOutputSchema,
    type CreatePlanFeatureResponse,
} from './create-plan.feature'
import {
    DeletePlanFeature,
    DeletePlanOutputSchema,
    type DeletePlanFeatureResponse,
} from './delete-plan.feature'
import {
    ListPlansFeature,
    ListPlansInputSchema,
    ListPlansOutputSchema,
    type ListPlansFeatureResponse,
} from './list-plans.feature'
import {
    UpdatePlanFeature,
    UpdatePlanInputSchema,
    UpdatePlanOutputSchema,
    type UpdatePlanFeatureResponse,
} from './update-plan.feature'

class CreatePlanInput extends createZodDto(CreatePlanInputSchema) {}
class PlanOutputDto extends createZodDto(CreatePlanOutputSchema) {}
class ListPlansQuery extends createZodDto(ListPlansInputSchema) {}
class ListPlansOutput extends createZodDto(ListPlansOutputSchema) {}
class UpdatePlanInput extends createZodDto(UpdatePlanInputSchema) {}
class UpdatePlanOutput extends createZodDto(UpdatePlanOutputSchema) {}
class DeletePlanOutput extends createZodDto(DeletePlanOutputSchema) {}

@Controller('workspaces/:workspaceId/plans')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class PlansController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: PlanOutputDto })
    async createPlan(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreatePlanInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreatePlanFeature,
            CreatePlanFeatureResponse
        >(
            new CreatePlanFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListPlansOutput })
    async listPlans(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListPlansQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPlansFeature,
            ListPlansFeatureResponse
        >(
            new ListPlansFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':planId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: UpdatePlanOutput })
    async updatePlan(
        @Param('workspaceId') workspaceId: string,
        @Param('planId') planId: string,
        @Body() body: UpdatePlanInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdatePlanFeature,
            UpdatePlanFeatureResponse
        >(
            new UpdatePlanFeature(
                body,
                workspaceId,
                planId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':planId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DeletePlanOutput })
    async deletePlan(
        @Param('workspaceId') workspaceId: string,
        @Param('planId') planId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeletePlanFeature,
            DeletePlanFeatureResponse
        >(
            new DeletePlanFeature(
                workspaceId,
                planId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
