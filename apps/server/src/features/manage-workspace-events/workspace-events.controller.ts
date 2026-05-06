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
    CreateWorkspaceEventFeature,
    CreateWorkspaceEventFeatureInputSchema,
    CreateWorkspaceEventFeatureOutputSchema,
    type CreateWorkspaceEventFeatureResponse,
} from './create-workspace-event.feature'
import {
    DeleteWorkspaceEventFeature,
    DeleteWorkspaceEventFeatureOutputSchema,
    type DeleteWorkspaceEventFeatureResponse,
} from './delete-workspace-event.feature'
import {
    ListWorkspaceEventsFeature,
    ListWorkspaceEventsFeatureInputSchema,
    ListWorkspaceEventsFeatureOutputSchema,
    type ListWorkspaceEventsFeatureResponse,
} from './list-workspace-events.feature'
import {
    UpdateWorkspaceEventFeature,
    UpdateWorkspaceEventFeatureInputSchema,
    UpdateWorkspaceEventFeatureOutputSchema,
    type UpdateWorkspaceEventFeatureResponse,
} from './update-workspace-event.feature'

class CreateEventInput extends createZodDto(
    CreateWorkspaceEventFeatureInputSchema,
) {}
class CreateEventOutput extends createZodDto(
    CreateWorkspaceEventFeatureOutputSchema,
) {}
class UpdateEventInput extends createZodDto(
    UpdateWorkspaceEventFeatureInputSchema,
) {}
class UpdateEventOutput extends createZodDto(
    UpdateWorkspaceEventFeatureOutputSchema,
) {}
class DeleteEventOutput extends createZodDto(
    DeleteWorkspaceEventFeatureOutputSchema,
) {}
class ListEventsQuery extends createZodDto(
    ListWorkspaceEventsFeatureInputSchema,
) {}
class ListEventsOutput extends createZodDto(
    ListWorkspaceEventsFeatureOutputSchema,
) {}

// Reads (GET) are open to any workspace member — students can see all
// upcoming workspace events. Writes are gated by COACHING_ROLES via the
// per-method @Roles override.
@Controller('workspaces/:workspaceId/events')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class WorkspaceEventsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListEventsOutput })
    async list(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListEventsQuery,
    ) {
        return await this.bus.execute<
            ListWorkspaceEventsFeature,
            ListWorkspaceEventsFeatureResponse
        >(new ListWorkspaceEventsFeature(query, workspaceId))
    }

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: CreateEventOutput })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateEventInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateWorkspaceEventFeature,
            CreateWorkspaceEventFeatureResponse
        >(new CreateWorkspaceEventFeature(body, workspaceId, user.userId))
    }

    @Patch(':eventId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: UpdateEventOutput })
    async update(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId') eventId: string,
        @Body() body: UpdateEventInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateWorkspaceEventFeature,
            UpdateWorkspaceEventFeatureResponse
        >(
            new UpdateWorkspaceEventFeature(
                body,
                workspaceId,
                eventId,
                user.userId,
            ),
        )
    }

    @Delete(':eventId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DeleteEventOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId') eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteWorkspaceEventFeature,
            DeleteWorkspaceEventFeatureResponse
        >(new DeleteWorkspaceEventFeature(workspaceId, eventId, user.userId))
    }
}
