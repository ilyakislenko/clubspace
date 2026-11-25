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
} from '../../shared/decorators/current-user.decorator'
import { ORG_ADMINS, ORG_STAFF, OrgRoles } from '../../shared/decorators/org-roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { OrganizationMemberGuard } from '../../shared/guards/organization-member.guard'
import { OrganizationsEnabledGuard } from '../../shared/guards/organizations-enabled.guard'
import {
    CreateOrganizationLogoUploadFeature,
    type CreateOrganizationLogoUploadFeatureResponse,
    CreateOrganizationLogoUploadInputSchema,
    CreateOrganizationLogoUploadOutputSchema,
} from './create-organization-logo-upload.feature'
import {
    GetOrganizationFeature,
    type GetOrganizationFeatureResponse,
    GetOrganizationOutputSchema,
} from './get-organization.feature'
import {
    InviteClubToOrganizationFeature,
    type InviteClubToOrganizationFeatureResponse,
    InviteClubToOrganizationInputSchema,
    InviteClubToOrganizationOutputSchema,
} from './invite-club-to-organization.feature'
import {
    ListOrgAuditEventsFeature,
    type ListOrgAuditEventsFeatureResponse,
    ListOrgAuditEventsInputSchema,
    ListOrgAuditEventsOutputSchema,
} from './list-org-audit-events.feature'
import {
    ListOrganizationClubsFeature,
    type ListOrganizationClubsFeatureResponse,
    ListOrganizationClubsOutputSchema,
} from './list-organization-clubs.feature'
import {
    AddOrgMemberFeature,
    type AddOrgMemberFeatureResponse,
    AddOrgMemberInputSchema,
    AddOrgMemberOutputSchema,
    ListOrgMembersFeature,
    type ListOrgMembersFeatureResponse,
    ListOrgMembersOutputSchema,
    RemoveOrgMemberFeature,
    type RemoveOrgMemberFeatureResponse,
    RemoveOrgMemberOutputSchema,
} from './org-members.feature'
import {
    RemoveClubFromOrganizationFeature,
    type RemoveClubFromOrganizationFeatureResponse,
    RemoveClubFromOrganizationOutputSchema,
} from './remove-club-from-organization.feature'
import {
    UpdateOrganizationFeature,
    type UpdateOrganizationFeatureResponse,
    UpdateOrganizationInputSchema,
    UpdateOrganizationOutputSchema,
} from './update-organization.feature'

class GetOrganizationOutputDto extends createZodDto(GetOrganizationOutputSchema) {}
class UpdateOrganizationInputDto extends createZodDto(UpdateOrganizationInputSchema) {}
class UpdateOrganizationOutputDto extends createZodDto(UpdateOrganizationOutputSchema) {}
class CreateOrganizationLogoUploadInputDto extends createZodDto(
    CreateOrganizationLogoUploadInputSchema,
) {}
class CreateOrganizationLogoUploadOutputDto extends createZodDto(
    CreateOrganizationLogoUploadOutputSchema,
) {}
class ListOrganizationClubsOutputDto extends createZodDto(ListOrganizationClubsOutputSchema) {}
class InviteClubToOrganizationInputDto extends createZodDto(InviteClubToOrganizationInputSchema) {}
class InviteClubToOrganizationOutputDto extends createZodDto(
    InviteClubToOrganizationOutputSchema,
) {}
class RemoveClubFromOrganizationOutputDto extends createZodDto(
    RemoveClubFromOrganizationOutputSchema,
) {}
class ListOrgMembersOutputDto extends createZodDto(ListOrgMembersOutputSchema) {}
class AddOrgMemberInputDto extends createZodDto(AddOrgMemberInputSchema) {}
class AddOrgMemberOutputDto extends createZodDto(AddOrgMemberOutputSchema) {}
class RemoveOrgMemberOutputDto extends createZodDto(RemoveOrgMemberOutputSchema) {}
class ListOrgAuditEventsQueryDto extends createZodDto(ListOrgAuditEventsInputSchema) {}
class ListOrgAuditEventsOutputDto extends createZodDto(ListOrgAuditEventsOutputSchema) {}

// The org console (docs/design/2026-11-26-federation-hub-mvp.md §3.2). Org
// staff are not club staff: these routes never touch `workspaces/*`, and
// every route's @OrgRoles tier is repeated in its handler (assertOrgAdmin /
// assertOrgStaff, pinned by route-tier-consistency.spec.ts).
@Controller('orgs/:organizationId')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, OrganizationMemberGuard)
export class OrganizationsController {
    constructor(private readonly bus: FeaturesBus) {}

    @Get()
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: GetOrganizationOutputDto })
    async getOrganization(
        @Param('organizationId') organizationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetOrganizationFeature, GetOrganizationFeatureResponse>(
            new GetOrganizationFeature(organizationId, user.userId, user.isSuperAdmin),
        )
    }

    @Patch()
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: UpdateOrganizationOutputDto })
    async updateOrganization(
        @Param('organizationId') organizationId: string,
        @Body() body: UpdateOrganizationInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<UpdateOrganizationFeature, UpdateOrganizationFeatureResponse>(
            new UpdateOrganizationFeature(body, organizationId, user.userId, user.isSuperAdmin),
        )
    }

    @Post('logo-upload')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: CreateOrganizationLogoUploadOutputDto })
    async createOrganizationLogoUpload(
        @Param('organizationId') organizationId: string,
        @Body() body: CreateOrganizationLogoUploadInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateOrganizationLogoUploadFeature,
            CreateOrganizationLogoUploadFeatureResponse
        >(new CreateOrganizationLogoUploadFeature(body, organizationId, user.userId, user.isSuperAdmin))
    }

    @Get('clubs')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: ListOrganizationClubsOutputDto })
    async listOrganizationClubs(
        @Param('organizationId') organizationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListOrganizationClubsFeature, ListOrganizationClubsFeatureResponse>(
            new ListOrganizationClubsFeature(organizationId, user.userId, user.isSuperAdmin),
        )
    }

    @Post('clubs/invitations')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: InviteClubToOrganizationOutputDto })
    async inviteClubToOrganization(
        @Param('organizationId') organizationId: string,
        @Body() body: InviteClubToOrganizationInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            InviteClubToOrganizationFeature,
            InviteClubToOrganizationFeatureResponse
        >(new InviteClubToOrganizationFeature(body, organizationId, user.userId, user.isSuperAdmin))
    }

    @Delete('clubs/:linkId')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: RemoveClubFromOrganizationOutputDto })
    async removeClubFromOrganization(
        @Param('organizationId') organizationId: string,
        @Param('linkId', ParseUUIDPipe) linkId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            RemoveClubFromOrganizationFeature,
            RemoveClubFromOrganizationFeatureResponse
        >(new RemoveClubFromOrganizationFeature(organizationId, linkId, user.userId, user.isSuperAdmin))
    }

    @Get('members')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: ListOrgMembersOutputDto })
    async listOrgMembers(
        @Param('organizationId') organizationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListOrgMembersFeature, ListOrgMembersFeatureResponse>(
            new ListOrgMembersFeature(organizationId, user.userId, user.isSuperAdmin),
        )
    }

    @Post('members')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: AddOrgMemberOutputDto })
    async addOrgMember(
        @Param('organizationId') organizationId: string,
        @Body() body: AddOrgMemberInputDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<AddOrgMemberFeature, AddOrgMemberFeatureResponse>(
            new AddOrgMemberFeature(body, organizationId, user.userId, user.isSuperAdmin),
        )
    }

    @Delete('members/:userId')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: RemoveOrgMemberOutputDto })
    async removeOrgMember(
        @Param('organizationId') organizationId: string,
        @Param('userId', ParseUUIDPipe) userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<RemoveOrgMemberFeature, RemoveOrgMemberFeatureResponse>(
            new RemoveOrgMemberFeature(organizationId, userId, user.userId, user.isSuperAdmin),
        )
    }

    @Get('audit')
    @OrgRoles(ORG_ADMINS)
    @ZodResponse({ type: ListOrgAuditEventsOutputDto })
    async listOrgAuditEvents(
        @Param('organizationId') organizationId: string,
        @Query() query: ListOrgAuditEventsQueryDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListOrgAuditEventsFeature, ListOrgAuditEventsFeatureResponse>(
            new ListOrgAuditEventsFeature(query, organizationId, user.userId, user.isSuperAdmin),
        )
    }
}
