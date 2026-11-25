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
import { ORG_STAFF, OrgRoles } from '../../../shared/decorators/org-roles.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { OrganizationMemberGuard } from '../../../shared/guards/organization-member.guard'
import {
    CreateOrgEventFeature,
    CreateOrgEventInputSchema,
    CreateOrgEventOutputSchema,
    type CreateOrgEventFeatureResponse,
} from './create-org-event.feature'
import {
    DeleteOrgEventFeature,
    DeleteOrgEventOutputSchema,
    type DeleteOrgEventFeatureResponse,
} from './delete-org-event.feature'
import {
    GetOrgEventFeature,
    GetOrgEventOutputSchema,
    type GetOrgEventFeatureResponse,
} from './get-org-event.feature'
import {
    ListOrgEventRegistrationsFeature,
    ListOrgEventRegistrationsOutputSchema,
    type ListOrgEventRegistrationsFeatureResponse,
} from './list-org-event-registrations.feature'
import {
    ListOrgEventsFeature,
    ListOrgEventsInputSchema,
    ListOrgEventsOutputSchema,
    type ListOrgEventsFeatureResponse,
} from './list-org-events.feature'
import {
    UpdateOrgEventFeature,
    UpdateOrgEventInputSchema,
    UpdateOrgEventOutputSchema,
    type UpdateOrgEventFeatureResponse,
} from './update-org-event.feature'

class ListOrgEventsQuery extends createZodDto(ListOrgEventsInputSchema) {}
class ListOrgEventsOutput extends createZodDto(ListOrgEventsOutputSchema) {}
class GetOrgEventOutput extends createZodDto(GetOrgEventOutputSchema) {}
class CreateOrgEventInput extends createZodDto(CreateOrgEventInputSchema) {}
class OrgEventOutputDto extends createZodDto(CreateOrgEventOutputSchema) {}
class UpdateOrgEventInput extends createZodDto(UpdateOrgEventInputSchema) {}
class UpdateOrgEventOutput extends createZodDto(UpdateOrgEventOutputSchema) {}
class DeleteOrgEventOutput extends createZodDto(DeleteOrgEventOutputSchema) {}
class ListOrgEventRegistrationsOutput extends createZodDto(
    ListOrgEventRegistrationsOutputSchema,
) {}

// «Календарь» of the org console: the whole team manages events.
@Controller('orgs/:organizationId/events')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, OrganizationMemberGuard)
export class OrgEventsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: ListOrgEventsOutput })
    async listOrgEvents(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Query() query: ListOrgEventsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListOrgEventsFeature, ListOrgEventsFeatureResponse>(
            new ListOrgEventsFeature(query, organizationId, user.userId, user.isSuperAdmin),
        )
    }

    @Post()
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: OrgEventOutputDto })
    async createOrgEvent(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Body() body: CreateOrgEventInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CreateOrgEventFeature, CreateOrgEventFeatureResponse>(
            new CreateOrgEventFeature(body, organizationId, user.userId, user.isSuperAdmin),
        )
    }

    @Get(':eventId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: GetOrgEventOutput })
    async getOrgEvent(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetOrgEventFeature, GetOrgEventFeatureResponse>(
            new GetOrgEventFeature(organizationId, eventId, user.userId, user.isSuperAdmin),
        )
    }

    @Patch(':eventId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: UpdateOrgEventOutput })
    async updateOrgEvent(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @Body() body: UpdateOrgEventInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<UpdateOrgEventFeature, UpdateOrgEventFeatureResponse>(
            new UpdateOrgEventFeature(
                body,
                organizationId,
                eventId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':eventId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: DeleteOrgEventOutput })
    async deleteOrgEvent(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<DeleteOrgEventFeature, DeleteOrgEventFeatureResponse>(
            new DeleteOrgEventFeature(organizationId, eventId, user.userId, user.isSuperAdmin),
        )
    }

    @Get(':eventId/registrations')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: ListOrgEventRegistrationsOutput })
    async listOrgEventRegistrations(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListOrgEventRegistrationsFeature,
            ListOrgEventRegistrationsFeatureResponse
        >(
            new ListOrgEventRegistrationsFeature(
                organizationId,
                eventId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
