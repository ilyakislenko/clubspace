import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListMyVideoNotesFeature,
    ListMyVideoNotesFeatureInputSchema,
    ListMyVideoNotesFeatureOutputSchema,
    ListMyVideoNotesFeatureResponse,
} from './list-my-video-notes.feature'

class ListMyVideoNotesQuery extends createZodDto(
    ListMyVideoNotesFeatureInputSchema,
) {}

class ListMyVideoNotesOutput extends createZodDto(
    ListMyVideoNotesFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/me/video-notes')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListMyVideoNotesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyVideoNotesOutput })
    async listMyVideoNotes(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListMyVideoNotesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        const isStaff =
            user.isSuperAdmin ||
            (user.role
                ? STAFF_ROLES.includes(user.role.name as (typeof STAFF_ROLES)[number])
                : false)
        return await this.bus.execute<
            ListMyVideoNotesFeature,
            ListMyVideoNotesFeatureResponse
        >(new ListMyVideoNotesFeature(user.userId, workspaceId, query, isStaff))
    }
}
