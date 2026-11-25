import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { RoleGuard } from '../../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../../shared/guards/workspace-member.guard'
import {
    CancelOrgEventRegistrationFeature,
    CancelOrgEventRegistrationOutputSchema,
    type CancelOrgEventRegistrationFeatureResponse,
} from './cancel-org-event-registration.feature'
import {
    ListClubOrgEventsFeature,
    ListClubOrgEventsOutputSchema,
    type ListClubOrgEventsFeatureResponse,
} from './list-club-org-events.feature'
import {
    ListOrgEventStudentsFeature,
    ListOrgEventStudentsOutputSchema,
    type ListOrgEventStudentsFeatureResponse,
} from './list-org-event-students.feature'
import {
    OrgEventRegistrationRefOutputSchema,
    RegisterForOrgEventFeature,
    RegisterForOrgEventInputSchema,
    type RegisterForOrgEventFeatureResponse,
} from './register-for-org-event.feature'

class ListClubOrgEventsOutput extends createZodDto(ListClubOrgEventsOutputSchema) {}
class RegisterForOrgEventInput extends createZodDto(RegisterForOrgEventInputSchema) {}
class OrgEventRegistrationRefOutput extends createZodDto(
    OrgEventRegistrationRefOutputSchema,
) {}
class CancelOrgEventRegistrationOutput extends createZodDto(
    CancelOrgEventRegistrationOutputSchema,
) {}
class ListOrgEventStudentsOutput extends createZodDto(ListOrgEventStudentsOutputSchema) {}

// Federation events inside a member club's app. Member actions carry no
// @Roles (any member; a guardian acting for a child included) — the handlers
// do the rules; the coach's student picker is coach-tiered.
@Controller('workspaces/:workspaceId')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubOrgEventsController {
    constructor(private bus: FeaturesBus) {}

    @Get('org-events')
    @ZodResponse({ type: ListClubOrgEventsOutput })
    async listClubOrgEvents(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListClubOrgEventsFeature, ListClubOrgEventsFeatureResponse>(
            new ListClubOrgEventsFeature(workspaceId, user.userId, user.role?.name ?? null),
        )
    }

    @Post('org-events/:eventId/registrations')
    @ZodResponse({ type: OrgEventRegistrationRefOutput })
    async registerForOrgEvent(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @Body() body: RegisterForOrgEventInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<RegisterForOrgEventFeature, RegisterForOrgEventFeatureResponse>(
            new RegisterForOrgEventFeature(
                body,
                workspaceId,
                eventId,
                user.userId,
                user.guardianId ?? null,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('org-event-registrations/:registrationId')
    @ZodResponse({ type: CancelOrgEventRegistrationOutput })
    async cancelOrgEventRegistration(
        @Param('workspaceId') workspaceId: string,
        @Param('registrationId', ParseUUIDPipe) registrationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CancelOrgEventRegistrationFeature,
            CancelOrgEventRegistrationFeatureResponse
        >(
            new CancelOrgEventRegistrationFeature(
                workspaceId,
                registrationId,
                user.userId,
                user.guardianId ?? null,
            ),
        )
    }

    @Get('org-events/:eventId/students')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListOrgEventStudentsOutput })
    async listOrgEventStudents(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListOrgEventStudentsFeature,
            ListOrgEventStudentsFeatureResponse
        >(
            new ListOrgEventStudentsFeature(
                workspaceId,
                eventId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
