import {
    Body,
    Controller,
    Get,
    Headers,
    Ip,
    Param,
    ParseUUIDPipe,
    Put,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { RoleGuard } from '../../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../../shared/guards/workspace-member.guard'
import {
    ListMyClubOrganizationsFeature,
    ListMyClubOrganizationsOutputSchema,
    type ListMyClubOrganizationsFeatureResponse,
} from './list-my-club-organizations.feature'
import {
    SetMyOrganizationConsentFeature,
    SetMyOrganizationConsentInputSchema,
    SetMyOrganizationConsentOutputSchema,
    type SetMyOrganizationConsentFeatureResponse,
} from './set-my-organization-consent.feature'

class ListMyClubOrganizationsOutput extends createZodDto(
    ListMyClubOrganizationsOutputSchema,
) {}
class SetMyOrganizationConsentInput extends createZodDto(
    SetMyOrganizationConsentInputSchema,
) {}
class SetMyOrganizationConsentOutput extends createZodDto(
    SetMyOrganizationConsentOutputSchema,
) {}

// A member's own consent to show an organization of their club their name,
// belt, club and event registrations. Any member; a guardian acting for a
// child decides for the child.
@Controller('workspaces/:workspaceId/me/organizations')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class MyClubOrganizationsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyClubOrganizationsOutput })
    async listMyClubOrganizations(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListMyClubOrganizationsFeature,
            ListMyClubOrganizationsFeatureResponse
        >(new ListMyClubOrganizationsFeature(workspaceId, user.userId, user.guardianId ?? null))
    }

    @Put(':organizationId/consent')
    @ZodResponse({ type: SetMyOrganizationConsentOutput })
    async setMyOrganizationConsent(
        @Param('workspaceId') workspaceId: string,
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Body() body: SetMyOrganizationConsentInput,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return this.bus.execute<
            SetMyOrganizationConsentFeature,
            SetMyOrganizationConsentFeatureResponse
        >(
            new SetMyOrganizationConsentFeature(
                body,
                workspaceId,
                organizationId,
                user.userId,
                user.guardianId ?? null,
                ip ?? null,
                userAgent ?? null,
            ),
        )
    }
}
