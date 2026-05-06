import {
    Body,
    Controller,
    Delete,
    Param,
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
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateGroupSlotFeature,
    CreateGroupSlotFeatureInputSchema,
    CreateGroupSlotFeatureOutputSchema,
    type CreateGroupSlotFeatureResponse,
} from './create-group-slot.feature'
import {
    UpdateGroupSlotFeature,
    UpdateGroupSlotFeatureInputSchema,
    UpdateGroupSlotFeatureOutputSchema,
    type UpdateGroupSlotFeatureResponse,
} from './update-group-slot.feature'
import {
    DeleteGroupSlotFeature,
    DeleteGroupSlotFeatureOutputSchema,
    type DeleteGroupSlotFeatureResponse,
} from './delete-group-slot.feature'
import {
    CreateGroupExceptionFeature,
    CreateGroupExceptionFeatureInputSchema,
    CreateGroupExceptionFeatureOutputSchema,
    type CreateGroupExceptionFeatureResponse,
} from './create-group-exception.feature'
import {
    UpdateGroupExceptionFeature,
    UpdateGroupExceptionFeatureInputSchema,
    UpdateGroupExceptionFeatureOutputSchema,
    type UpdateGroupExceptionFeatureResponse,
} from './update-group-exception.feature'
import {
    DeleteGroupExceptionFeature,
    DeleteGroupExceptionFeatureOutputSchema,
    type DeleteGroupExceptionFeatureResponse,
} from './delete-group-exception.feature'

class CreateSlotInput extends createZodDto(
    CreateGroupSlotFeatureInputSchema,
) {}
class CreateSlotOutput extends createZodDto(
    CreateGroupSlotFeatureOutputSchema,
) {}
class UpdateSlotInput extends createZodDto(
    UpdateGroupSlotFeatureInputSchema,
) {}
class UpdateSlotOutput extends createZodDto(
    UpdateGroupSlotFeatureOutputSchema,
) {}
class DeleteSlotOutput extends createZodDto(
    DeleteGroupSlotFeatureOutputSchema,
) {}
class CreateExceptionInput extends createZodDto(
    CreateGroupExceptionFeatureInputSchema,
) {}
class CreateExceptionOutput extends createZodDto(
    CreateGroupExceptionFeatureOutputSchema,
) {}
class UpdateExceptionInput extends createZodDto(
    UpdateGroupExceptionFeatureInputSchema,
) {}
class UpdateExceptionOutput extends createZodDto(
    UpdateGroupExceptionFeatureOutputSchema,
) {}
class DeleteExceptionOutput extends createZodDto(
    DeleteGroupExceptionFeatureOutputSchema,
) {}

// All routes share the same workspace-member guard. Per-row write
// permission is enforced inside each handler via RbacService.
// assertCanWriteGroup, which reads the coach scope and confirms the
// caller actually owns the target group (or has admin scope).
@Controller('workspaces/:workspaceId/groups/:groupId/schedule')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GroupScheduleController {
    constructor(private bus: FeaturesBus) {}

    @Post('slots')
    @ZodResponse({ type: CreateSlotOutput })
    async createSlot(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Body() body: CreateSlotInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateGroupSlotFeature,
            CreateGroupSlotFeatureResponse
        >(
            new CreateGroupSlotFeature(
                body,
                workspaceId,
                groupId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch('slots/:slotId')
    @ZodResponse({ type: UpdateSlotOutput })
    async updateSlot(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Param('slotId') slotId: string,
        @Body() body: UpdateSlotInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateGroupSlotFeature,
            UpdateGroupSlotFeatureResponse
        >(
            new UpdateGroupSlotFeature(
                body,
                workspaceId,
                groupId,
                slotId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('slots/:slotId')
    @ZodResponse({ type: DeleteSlotOutput })
    async deleteSlot(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Param('slotId') slotId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteGroupSlotFeature,
            DeleteGroupSlotFeatureResponse
        >(
            new DeleteGroupSlotFeature(
                workspaceId,
                groupId,
                slotId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('exceptions')
    @ZodResponse({ type: CreateExceptionOutput })
    async createException(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Body() body: CreateExceptionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateGroupExceptionFeature,
            CreateGroupExceptionFeatureResponse
        >(
            new CreateGroupExceptionFeature(
                body,
                workspaceId,
                groupId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch('exceptions/:exceptionId')
    @ZodResponse({ type: UpdateExceptionOutput })
    async updateException(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Param('exceptionId') exceptionId: string,
        @Body() body: UpdateExceptionInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateGroupExceptionFeature,
            UpdateGroupExceptionFeatureResponse
        >(
            new UpdateGroupExceptionFeature(
                body,
                workspaceId,
                groupId,
                exceptionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('exceptions/:exceptionId')
    @ZodResponse({ type: DeleteExceptionOutput })
    async deleteException(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Param('exceptionId') exceptionId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteGroupExceptionFeature,
            DeleteGroupExceptionFeatureResponse
        >(
            new DeleteGroupExceptionFeature(
                workspaceId,
                groupId,
                exceptionId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
