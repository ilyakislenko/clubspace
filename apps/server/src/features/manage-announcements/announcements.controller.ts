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
    CreateAnnouncementFeature,
    CreateAnnouncementInputSchema,
    CreateAnnouncementOutputSchema,
    type CreateAnnouncementFeatureResponse,
} from './create-announcement.feature'
import {
    DeleteAnnouncementFeature,
    DeleteAnnouncementOutputSchema,
    type DeleteAnnouncementFeatureResponse,
} from './delete-announcement.feature'
import {
    GetAnnouncementFeedFeature,
    GetAnnouncementFeedInputSchema,
    GetAnnouncementFeedOutputSchema,
    type GetAnnouncementFeedFeatureResponse,
} from './get-feed.feature'
import {
    ListAnnouncementsFeature,
    ListAnnouncementsInputSchema,
    ListAnnouncementsOutputSchema,
    type ListAnnouncementsFeatureResponse,
} from './list-announcements.feature'
import {
    UpdateAnnouncementFeature,
    UpdateAnnouncementInputSchema,
    UpdateAnnouncementOutputSchema,
    type UpdateAnnouncementFeatureResponse,
} from './update-announcement.feature'

class CreateAnnouncementInput extends createZodDto(
    CreateAnnouncementInputSchema,
) {}
class AnnouncementOutputDto extends createZodDto(
    CreateAnnouncementOutputSchema,
) {}
class ListAnnouncementsQuery extends createZodDto(
    ListAnnouncementsInputSchema,
) {}
class AnnouncementListOutput extends createZodDto(
    ListAnnouncementsOutputSchema,
) {}
class AnnouncementFeedQuery extends createZodDto(
    GetAnnouncementFeedInputSchema,
) {}
class AnnouncementFeedOutput extends createZodDto(
    GetAnnouncementFeedOutputSchema,
) {}
class UpdateAnnouncementInput extends createZodDto(
    UpdateAnnouncementInputSchema,
) {}
class UpdateAnnouncementOutput extends createZodDto(
    UpdateAnnouncementOutputSchema,
) {}
class DeleteAnnouncementOutput extends createZodDto(
    DeleteAnnouncementOutputSchema,
) {}

@Controller('workspaces/:workspaceId/announcements')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AnnouncementsController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AnnouncementOutputDto })
    async createAnnouncement(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateAnnouncementInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateAnnouncementFeature,
            CreateAnnouncementFeatureResponse
        >(
            new CreateAnnouncementFeature(
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
    @ZodResponse({ type: AnnouncementListOutput })
    async listAnnouncements(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListAnnouncementsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListAnnouncementsFeature,
            ListAnnouncementsFeatureResponse
        >(
            new ListAnnouncementsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    // Any workspace member — the published feed. No @Roles.
    @Get('feed')
    @ZodResponse({ type: AnnouncementFeedOutput })
    async getAnnouncementFeed(
        @Param('workspaceId') workspaceId: string,
        @Query() query: AnnouncementFeedQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetAnnouncementFeedFeature,
            GetAnnouncementFeedFeatureResponse
        >(new GetAnnouncementFeedFeature(query, workspaceId, user.userId))
    }

    @Patch(':announcementId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: UpdateAnnouncementOutput })
    async updateAnnouncement(
        @Param('workspaceId') workspaceId: string,
        @Param('announcementId') announcementId: string,
        @Body() body: UpdateAnnouncementInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateAnnouncementFeature,
            UpdateAnnouncementFeatureResponse
        >(
            new UpdateAnnouncementFeature(
                body,
                workspaceId,
                announcementId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':announcementId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DeleteAnnouncementOutput })
    async deleteAnnouncement(
        @Param('workspaceId') workspaceId: string,
        @Param('announcementId') announcementId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteAnnouncementFeature,
            DeleteAnnouncementFeatureResponse
        >(
            new DeleteAnnouncementFeature(
                workspaceId,
                announcementId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
