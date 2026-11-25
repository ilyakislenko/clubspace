import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
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
} from '../../../shared/decorators/current-user.decorator'
import {
    ORG_ADMINS,
    ORG_STAFF,
    OrgRoles,
} from '../../../shared/decorators/org-roles.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { OrganizationMemberGuard } from '../../../shared/guards/organization-member.guard'
import {
    CreateOrgAnnouncementFeature,
    CreateOrgAnnouncementInputSchema,
    CreateOrgAnnouncementOutputSchema,
    type CreateOrgAnnouncementFeatureResponse,
} from './create-org-announcement.feature'
import {
    DeleteOrgAnnouncementFeature,
    DeleteOrgAnnouncementOutputSchema,
    type DeleteOrgAnnouncementFeatureResponse,
} from './delete-org-announcement.feature'
import {
    ListOrgAnnouncementsFeature,
    ListOrgAnnouncementsInputSchema,
    ListOrgAnnouncementsOutputSchema,
    type ListOrgAnnouncementsFeatureResponse,
} from './list-org-announcements.feature'
import {
    UpdateOrgAnnouncementFeature,
    UpdateOrgAnnouncementInputSchema,
    UpdateOrgAnnouncementOutputSchema,
    type UpdateOrgAnnouncementFeatureResponse,
} from './update-org-announcement.feature'

class ListOrgAnnouncementsQuery extends createZodDto(ListOrgAnnouncementsInputSchema) {}
class ListOrgAnnouncementsOutput extends createZodDto(ListOrgAnnouncementsOutputSchema) {}
class CreateOrgAnnouncementInput extends createZodDto(CreateOrgAnnouncementInputSchema) {}
class OrgAnnouncementOutputDto extends createZodDto(CreateOrgAnnouncementOutputSchema) {}
class UpdateOrgAnnouncementInput extends createZodDto(UpdateOrgAnnouncementInputSchema) {}
class UpdateOrgAnnouncementOutput extends createZodDto(UpdateOrgAnnouncementOutputSchema) {}
class DeleteOrgAnnouncementOutput extends createZodDto(DeleteOrgAnnouncementOutputSchema) {}

// «Объявления» of the org console: the team reads, org admins write.
@Controller('orgs/:organizationId/announcements')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, OrganizationMemberGuard)
export class OrgAnnouncementsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: ListOrgAnnouncementsOutput })
    async listOrgAnnouncements(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Query() query: ListOrgAnnouncementsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListOrgAnnouncementsFeature,
            ListOrgAnnouncementsFeatureResponse
        >(
            new ListOrgAnnouncementsFeature(
                query,
                organizationId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: OrgAnnouncementOutputDto })
    async createOrgAnnouncement(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Body() body: CreateOrgAnnouncementInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateOrgAnnouncementFeature,
            CreateOrgAnnouncementFeatureResponse
        >(
            new CreateOrgAnnouncementFeature(
                body,
                organizationId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':announcementId')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: UpdateOrgAnnouncementOutput })
    async updateOrgAnnouncement(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('announcementId', ParseUUIDPipe) announcementId: string,
        @Body() body: UpdateOrgAnnouncementInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateOrgAnnouncementFeature,
            UpdateOrgAnnouncementFeatureResponse
        >(
            new UpdateOrgAnnouncementFeature(
                body,
                organizationId,
                announcementId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':announcementId')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: DeleteOrgAnnouncementOutput })
    async deleteOrgAnnouncement(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('announcementId', ParseUUIDPipe) announcementId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteOrgAnnouncementFeature,
            DeleteOrgAnnouncementFeatureResponse
        >(
            new DeleteOrgAnnouncementFeature(
                organizationId,
                announcementId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
