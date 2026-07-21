import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
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
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateJournalEntryFeature,
    CreateJournalEntryInputSchema,
    CreateJournalEntryOutputSchema,
    type CreateJournalEntryFeatureResponse,
} from './create-journal-entry.feature'
import {
    DeleteJournalEntryFeature,
    DeleteJournalEntryOutputSchema,
    type DeleteJournalEntryFeatureResponse,
} from './delete-journal-entry.feature'
import {
    ListJournalFeature,
    ListJournalInputSchema,
    ListJournalOutputSchema,
    type ListJournalFeatureResponse,
} from './list-journal.feature'

class ListJournalQuery extends createZodDto(ListJournalInputSchema) {}
class ListJournalOutput extends createZodDto(ListJournalOutputSchema) {}
class CreateJournalEntryInput extends createZodDto(
    CreateJournalEntryInputSchema,
) {}
class CreateJournalEntryOutput extends createZodDto(
    CreateJournalEntryOutputSchema,
) {}
class DeleteJournalEntryOutput extends createZodDto(
    DeleteJournalEntryOutputSchema,
) {}

// A member's own training journal — member-scoped, no @Roles.
@Controller('workspaces/:workspaceId/me/journal')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class TrainingJournalController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListJournalOutput })
    async list(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListJournalQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListJournalFeature, ListJournalFeatureResponse>(
            new ListJournalFeature(query, workspaceId, user.userId),
        )
    }

    @Post()
    @ZodResponse({ type: CreateJournalEntryOutput })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateJournalEntryInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateJournalEntryFeature,
            CreateJournalEntryFeatureResponse
        >(new CreateJournalEntryFeature(body, workspaceId, user.userId))
    }

    @Delete(':entryId')
    @ZodResponse({ type: DeleteJournalEntryOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('entryId') entryId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteJournalEntryFeature,
            DeleteJournalEntryFeatureResponse
        >(new DeleteJournalEntryFeature(workspaceId, user.userId, entryId))
    }
}
