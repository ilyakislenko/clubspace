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
} from '../../shared/decorators/current-user.decorator'
import {
    COACHING_ROLES,
    Roles,
    STAFF_ROLES,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CancelEventRegistrationFeature,
    CancelEventRegistrationOutputSchema,
    type CancelEventRegistrationFeatureResponse,
} from './cancel-event-registration.feature'
import {
    ListEventRegistrationsFeature,
    ListEventRegistrationsOutputSchema,
    type ListEventRegistrationsFeatureResponse,
} from './list-event-registrations.feature'
import {
    MarkEventRegistrationPaidFeature,
    MarkEventRegistrationPaidInputSchema,
    MarkEventRegistrationPaidOutputSchema,
    type MarkEventRegistrationPaidFeatureResponse,
} from './mark-event-registration-paid.feature'
import {
    PayEventRegistrationOnlineFeature,
    PayEventRegistrationOnlineOutputSchema,
    type PayEventRegistrationOnlineFeatureResponse,
} from './pay-event-registration-online.feature'
import {
    RegisterForEventFeature,
    RegisterForEventOutputSchema,
    type RegisterForEventFeatureResponse,
} from './register-for-event.feature'
import {
    UnmarkEventRegistrationPaidFeature,
    UnmarkEventRegistrationPaidOutputSchema,
    type UnmarkEventRegistrationPaidFeatureResponse,
} from './unmark-event-registration-paid.feature'

class EventRegistrationOutput extends createZodDto(RegisterForEventOutputSchema) {}
class CancelEventRegistrationOutput extends createZodDto(
    CancelEventRegistrationOutputSchema,
) {}
class EventRegistrationsOutput extends createZodDto(
    ListEventRegistrationsOutputSchema,
) {}
class MarkEventRegistrationPaidInput extends createZodDto(
    MarkEventRegistrationPaidInputSchema,
) {}
class MarkEventRegistrationPaidOutput extends createZodDto(
    MarkEventRegistrationPaidOutputSchema,
) {}
class UnmarkEventRegistrationPaidOutput extends createZodDto(
    UnmarkEventRegistrationPaidOutputSchema,
) {}
class EventTicketCheckoutOutput extends createZodDto(
    PayEventRegistrationOnlineOutputSchema,
) {}

// Registration for events with a price or a limit of places. Member actions
// carry no @Roles (any member; a guardian acting for a child included) — the
// service does the rules. The staff list and the «paid» marks are tiered.
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class EventRegistrationsController {
    constructor(private bus: FeaturesBus) {}

    @Post('events/:eventId/registrations')
    @ZodResponse({ type: EventRegistrationOutput })
    async registerForEvent(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RegisterForEventFeature,
            RegisterForEventFeatureResponse
        >(
            new RegisterForEventFeature(
                workspaceId,
                eventId,
                user.userId,
                user.guardianId ?? user.userId,
            ),
        )
    }

    @Delete('event-registrations/:registrationId')
    @ZodResponse({ type: CancelEventRegistrationOutput })
    async cancelEventRegistration(
        @Param('workspaceId') workspaceId: string,
        @Param('registrationId', ParseUUIDPipe) registrationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CancelEventRegistrationFeature,
            CancelEventRegistrationFeatureResponse
        >(new CancelEventRegistrationFeature(workspaceId, registrationId, user.userId))
    }

    // The member pays their own ticket online (a guardian the child's, via
    // X-Act-As); the app opens the returned provider page.
    @Post('event-registrations/:registrationId/checkout')
    @ZodResponse({ type: EventTicketCheckoutOutput })
    async payEventRegistrationOnline(
        @Param('workspaceId') workspaceId: string,
        @Param('registrationId', ParseUUIDPipe) registrationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            PayEventRegistrationOnlineFeature,
            PayEventRegistrationOnlineFeatureResponse
        >(
            new PayEventRegistrationOnlineFeature(
                workspaceId,
                registrationId,
                user.userId,
                user.guardianId ?? user.userId,
            ),
        )
    }

    @Get('events/:eventId/registrations')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: EventRegistrationsOutput })
    async listEventRegistrations(
        @Param('workspaceId') workspaceId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListEventRegistrationsFeature,
            ListEventRegistrationsFeatureResponse
        >(
            new ListEventRegistrationsFeature(
                workspaceId,
                eventId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('event-registrations/:registrationId/payment')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: MarkEventRegistrationPaidOutput })
    async markEventRegistrationPaid(
        @Param('workspaceId') workspaceId: string,
        @Param('registrationId', ParseUUIDPipe) registrationId: string,
        @Body() body: MarkEventRegistrationPaidInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            MarkEventRegistrationPaidFeature,
            MarkEventRegistrationPaidFeatureResponse
        >(
            new MarkEventRegistrationPaidFeature(
                body,
                workspaceId,
                registrationId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('event-registrations/:registrationId/payment')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UnmarkEventRegistrationPaidOutput })
    async unmarkEventRegistrationPaid(
        @Param('workspaceId') workspaceId: string,
        @Param('registrationId', ParseUUIDPipe) registrationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UnmarkEventRegistrationPaidFeature,
            UnmarkEventRegistrationPaidFeatureResponse
        >(
            new UnmarkEventRegistrationPaidFeature(
                workspaceId,
                registrationId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
