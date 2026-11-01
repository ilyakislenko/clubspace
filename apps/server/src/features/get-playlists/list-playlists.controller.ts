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
    ListPlaylistsFeature,
    ListPlaylistsFeatureInputSchema,
    ListPlaylistsFeatureOutputSchema,
    ListPlaylistsFeatureResponse,
} from './list-playlists.feature'

class ListPlaylistsQuery extends createZodDto(
    ListPlaylistsFeatureInputSchema,
) {}

class ListPlaylistsOutput extends createZodDto(
    ListPlaylistsFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/playlists')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListPlaylistsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListPlaylistsOutput })
    async listPlaylists(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListPlaylistsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        const isStaff =
            user.isSuperAdmin ||
            (user.role
                ? STAFF_ROLES.includes(user.role.name as (typeof STAFF_ROLES)[number])
                : false)
        return await this.bus.execute<
            ListPlaylistsFeature,
            ListPlaylistsFeatureResponse
        >(new ListPlaylistsFeature(query, workspaceId, user.userId, isStaff))
    }
}
