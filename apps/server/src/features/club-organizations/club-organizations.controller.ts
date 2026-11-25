import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { CLUB_ADMINS, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../shared/guards/organizations-enabled.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AcceptOrganizationInviteFeature,
    AcceptOrganizationInviteInputSchema,
    type ClubOrganizationLinkResponse,
    ClubOrganizationLinkOutputSchema,
    DeclineOrganizationInviteFeature,
    LeaveOrganizationFeature,
    ListClubOrganizationsFeature,
    type ListClubOrganizationsFeatureResponse,
    ListClubOrganizationsOutputSchema,
    UpdateOrganizationSharingFeature,
    UpdateOrganizationSharingInputSchema,
} from './club-organizations.feature'

class ListClubOrganizationsOutputDto extends createZodDto(ListClubOrganizationsOutputSchema) {}
class AcceptOrganizationInviteInputDto extends createZodDto(AcceptOrganizationInviteInputSchema) {}
class ClubOrganizationLinkOutputDto extends createZodDto(ClubOrganizationLinkOutputSchema) {}
class UpdateOrganizationSharingInputDto extends createZodDto(
    UpdateOrganizationSharingInputSchema,
) {}

// «Настройки → Федерация» (docs/design/2026-11-26-federation-hub-mvp.md
// §3.3): the club's own decisions about sharing its data, so CLUB_ADMINS with
// assertClubAdmin in each handler; accepting is owner-only on top.
@Controller('workspaces/:workspaceId/organizations')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubOrganizationsController {
    constructor(private readonly bus: FeaturesBus) {}

    @Get()
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ListClubOrganizationsOutputDto })
    async listClubOrganizations(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListClubOrganizationsFeature, ListClubOrganizationsFeatureResponse>(
            new ListClubOrganizationsFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':linkId/accept')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ClubOrganizationLinkOutputDto })
    async acceptOrganizationInvite(
        @Param('workspaceId') workspaceId: string,
        @Param('linkId', ParseUUIDPipe) linkId: string,
        @Body() body: AcceptOrganizationInviteInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<AcceptOrganizationInviteFeature, ClubOrganizationLinkResponse>(
            new AcceptOrganizationInviteFeature(
                body,
                workspaceId,
                linkId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':linkId/decline')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ClubOrganizationLinkOutputDto })
    async declineOrganizationInvite(
        @Param('workspaceId') workspaceId: string,
        @Param('linkId', ParseUUIDPipe) linkId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<DeclineOrganizationInviteFeature, ClubOrganizationLinkResponse>(
            new DeclineOrganizationInviteFeature(
                workspaceId,
                linkId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':linkId/sharing')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ClubOrganizationLinkOutputDto })
    async updateOrganizationSharing(
        @Param('workspaceId') workspaceId: string,
        @Param('linkId', ParseUUIDPipe) linkId: string,
        @Body() body: UpdateOrganizationSharingInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<UpdateOrganizationSharingFeature, ClubOrganizationLinkResponse>(
            new UpdateOrganizationSharingFeature(
                body,
                workspaceId,
                linkId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':linkId/leave')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ClubOrganizationLinkOutputDto })
    async leaveOrganization(
        @Param('workspaceId') workspaceId: string,
        @Param('linkId', ParseUUIDPipe) linkId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<LeaveOrganizationFeature, ClubOrganizationLinkResponse>(
            new LeaveOrganizationFeature(
                workspaceId,
                linkId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
