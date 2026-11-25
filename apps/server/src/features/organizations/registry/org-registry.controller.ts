import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common'
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
    GetOrganizationRegistryPersonFeature,
    GetOrganizationRegistryPersonOutputSchema,
    type GetOrganizationRegistryPersonFeatureResponse,
} from './get-organization-registry-person.feature'
import {
    SearchOrganizationRegistryFeature,
    SearchOrganizationRegistryInputSchema,
    SearchOrganizationRegistryOutputSchema,
    type SearchOrganizationRegistryFeatureResponse,
} from './search-organization-registry.feature'

class SearchOrganizationRegistryQuery extends createZodDto(
    SearchOrganizationRegistryInputSchema,
) {}
class SearchOrganizationRegistryOutput extends createZodDto(
    SearchOrganizationRegistryOutputSchema,
) {}
class GetOrganizationRegistryPersonOutput extends createZodDto(
    GetOrganizationRegistryPersonOutputSchema,
) {}

// «Реестр поясов»: belts confirmed by member clubs, consenting people only.
@Controller('orgs/:organizationId/registry')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, OrganizationMemberGuard)
export class OrgRegistryController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: SearchOrganizationRegistryOutput })
    async searchOrganizationRegistry(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Query() query: SearchOrganizationRegistryQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            SearchOrganizationRegistryFeature,
            SearchOrganizationRegistryFeatureResponse
        >(
            new SearchOrganizationRegistryFeature(
                query,
                organizationId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':personKey')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: GetOrganizationRegistryPersonOutput })
    async getOrganizationRegistryPerson(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('personKey') personKey: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            GetOrganizationRegistryPersonFeature,
            GetOrganizationRegistryPersonFeatureResponse
        >(
            new GetOrganizationRegistryPersonFeature(
                organizationId,
                personKey,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
