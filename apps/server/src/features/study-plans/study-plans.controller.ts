import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AddMyStudyPlanItemFeature,
    AddMyStudyPlanItemFeatureInputSchema,
    AddMyStudyPlanItemFeatureOutputSchema,
    AddMyStudyPlanItemFeatureResponse,
} from './add-my-study-plan-item.feature'
import {
    CreateMyStudyPlanFeature,
    CreateMyStudyPlanFeatureInputSchema,
    CreateMyStudyPlanFeatureOutputSchema,
    CreateMyStudyPlanFeatureResponse,
} from './create-my-study-plan.feature'
import {
    DeleteMyStudyPlanItemFeature,
    DeleteMyStudyPlanItemFeatureOutputSchema,
    DeleteMyStudyPlanItemFeatureResponse,
} from './delete-my-study-plan-item.feature'
import {
    DeleteMyStudyPlanFeature,
    DeleteMyStudyPlanFeatureOutputSchema,
    DeleteMyStudyPlanFeatureResponse,
} from './delete-my-study-plan.feature'
import {
    GetMyStudyPlanFeature,
    GetMyStudyPlanFeatureOutputSchema,
    GetMyStudyPlanFeatureResponse,
} from './get-my-study-plan.feature'
import {
    ListMyStudyPlansFeature,
    ListMyStudyPlansFeatureOutputSchema,
    ListMyStudyPlansFeatureResponse,
} from './list-my-study-plans.feature'
import {
    ReorderMyStudyPlanItemsFeature,
    ReorderMyStudyPlanItemsFeatureInputSchema,
    ReorderMyStudyPlanItemsFeatureOutputSchema,
    ReorderMyStudyPlanItemsFeatureResponse,
} from './reorder-my-study-plan-items.feature'
import {
    UpdateMyStudyPlanItemFeature,
    UpdateMyStudyPlanItemFeatureInputSchema,
    UpdateMyStudyPlanItemFeatureOutputSchema,
    UpdateMyStudyPlanItemFeatureResponse,
} from './update-my-study-plan-item.feature'
import {
    UpdateMyStudyPlanFeature,
    UpdateMyStudyPlanFeatureInputSchema,
    UpdateMyStudyPlanFeatureOutputSchema,
    UpdateMyStudyPlanFeatureResponse,
} from './update-my-study-plan.feature'

class ListMyStudyPlansOutput extends createZodDto(
    ListMyStudyPlansFeatureOutputSchema,
) {}
class CreateMyStudyPlanInput extends createZodDto(
    CreateMyStudyPlanFeatureInputSchema,
) {}
class CreateMyStudyPlanOutput extends createZodDto(
    CreateMyStudyPlanFeatureOutputSchema,
) {}
class GetMyStudyPlanOutput extends createZodDto(GetMyStudyPlanFeatureOutputSchema) {}
class UpdateMyStudyPlanInput extends createZodDto(
    UpdateMyStudyPlanFeatureInputSchema,
) {}
class UpdateMyStudyPlanOutput extends createZodDto(
    UpdateMyStudyPlanFeatureOutputSchema,
) {}
class DeleteMyStudyPlanOutput extends createZodDto(
    DeleteMyStudyPlanFeatureOutputSchema,
) {}
class AddMyStudyPlanItemInput extends createZodDto(
    AddMyStudyPlanItemFeatureInputSchema,
) {}
class AddMyStudyPlanItemOutput extends createZodDto(
    AddMyStudyPlanItemFeatureOutputSchema,
) {}
class UpdateMyStudyPlanItemInput extends createZodDto(
    UpdateMyStudyPlanItemFeatureInputSchema,
) {}
class UpdateMyStudyPlanItemOutput extends createZodDto(
    UpdateMyStudyPlanItemFeatureOutputSchema,
) {}
class DeleteMyStudyPlanItemOutput extends createZodDto(
    DeleteMyStudyPlanItemFeatureOutputSchema,
) {}
class ReorderMyStudyPlanItemsInput extends createZodDto(
    ReorderMyStudyPlanItemsFeatureInputSchema,
) {}
class ReorderMyStudyPlanItemsOutput extends createZodDto(
    ReorderMyStudyPlanItemsFeatureOutputSchema,
) {}

// «Мои планы»: the member's own study plans in this club. Workspace-scoped
// member routes, so a guardian's X-Act-As works without @ActAsAllowed; each
// handler re-checks membership and ownership.
@Controller('workspaces/:workspaceId/me/study-plans')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class StudyPlansController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyStudyPlansOutput })
    async listMyStudyPlans(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListMyStudyPlansFeature,
            ListMyStudyPlansFeatureResponse
        >(new ListMyStudyPlansFeature(user.userId, workspaceId))
    }

    @Post()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: CreateMyStudyPlanOutput })
    async createMyStudyPlan(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateMyStudyPlanInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateMyStudyPlanFeature,
            CreateMyStudyPlanFeatureResponse
        >(new CreateMyStudyPlanFeature(user.userId, workspaceId, body))
    }

    @Get(':planId')
    @ZodResponse({ type: GetMyStudyPlanOutput })
    async getMyStudyPlan(
        @Param('workspaceId') workspaceId: string,
        @Param('planId', ParseUUIDPipe) planId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyStudyPlanFeature,
            GetMyStudyPlanFeatureResponse
        >(new GetMyStudyPlanFeature(user.userId, workspaceId, planId))
    }

    @Patch(':planId')
    @ZodResponse({ type: UpdateMyStudyPlanOutput })
    async updateMyStudyPlan(
        @Param('workspaceId') workspaceId: string,
        @Param('planId', ParseUUIDPipe) planId: string,
        @Body() body: UpdateMyStudyPlanInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateMyStudyPlanFeature,
            UpdateMyStudyPlanFeatureResponse
        >(new UpdateMyStudyPlanFeature(user.userId, workspaceId, planId, body))
    }

    @Delete(':planId')
    @ZodResponse({ type: DeleteMyStudyPlanOutput })
    async deleteMyStudyPlan(
        @Param('workspaceId') workspaceId: string,
        @Param('planId', ParseUUIDPipe) planId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteMyStudyPlanFeature,
            DeleteMyStudyPlanFeatureResponse
        >(new DeleteMyStudyPlanFeature(user.userId, workspaceId, planId))
    }

    @Post(':planId/items')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: AddMyStudyPlanItemOutput })
    async addMyStudyPlanItem(
        @Param('workspaceId') workspaceId: string,
        @Param('planId', ParseUUIDPipe) planId: string,
        @Body() body: AddMyStudyPlanItemInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddMyStudyPlanItemFeature,
            AddMyStudyPlanItemFeatureResponse
        >(new AddMyStudyPlanItemFeature(user.userId, workspaceId, planId, body))
    }

    @Put(':planId/items/order')
    @ZodResponse({ type: ReorderMyStudyPlanItemsOutput })
    async reorderMyStudyPlanItems(
        @Param('workspaceId') workspaceId: string,
        @Param('planId', ParseUUIDPipe) planId: string,
        @Body() body: ReorderMyStudyPlanItemsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ReorderMyStudyPlanItemsFeature,
            ReorderMyStudyPlanItemsFeatureResponse
        >(new ReorderMyStudyPlanItemsFeature(user.userId, workspaceId, planId, body))
    }

    @Patch(':planId/items/:itemId')
    @ZodResponse({ type: UpdateMyStudyPlanItemOutput })
    async updateMyStudyPlanItem(
        @Param('workspaceId') workspaceId: string,
        @Param('planId', ParseUUIDPipe) planId: string,
        @Param('itemId', ParseUUIDPipe) itemId: string,
        @Body() body: UpdateMyStudyPlanItemInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateMyStudyPlanItemFeature,
            UpdateMyStudyPlanItemFeatureResponse
        >(
            new UpdateMyStudyPlanItemFeature(
                user.userId,
                workspaceId,
                planId,
                itemId,
                body,
            ),
        )
    }

    @Delete(':planId/items/:itemId')
    @ZodResponse({ type: DeleteMyStudyPlanItemOutput })
    async deleteMyStudyPlanItem(
        @Param('workspaceId') workspaceId: string,
        @Param('planId', ParseUUIDPipe) planId: string,
        @Param('itemId', ParseUUIDPipe) itemId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteMyStudyPlanItemFeature,
            DeleteMyStudyPlanItemFeatureResponse
        >(new DeleteMyStudyPlanItemFeature(user.userId, workspaceId, planId, itemId))
    }
}
