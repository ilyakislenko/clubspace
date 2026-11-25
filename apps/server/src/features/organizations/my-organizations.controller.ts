import { Controller, Get, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../shared/guards/organizations-enabled.guard'
import {
    ListMyOrganizationsFeature,
    type ListMyOrganizationsFeatureResponse,
    ListMyOrganizationsOutputSchema,
} from './list-my-organizations.feature'

class ListMyOrganizationsOutputDto extends createZodDto(ListMyOrganizationsOutputSchema) {}

// `orgs/mine`: user-level (no organization in the path), so it sits outside
// the org console's OrganizationMemberGuard. Registered before
// OrganizationsController so `mine` is never read as an :organizationId.
@Controller('orgs')
@UseGuards(OrganizationsEnabledGuard, AuthGuard)
export class MyOrganizationsController {
    constructor(private readonly bus: FeaturesBus) {}

    @Get('mine')
    @ZodResponse({ type: ListMyOrganizationsOutputDto })
    async listMyOrganizations(@CurrentUser() user: CurrentUserPayload) {
        return this.bus.execute<ListMyOrganizationsFeature, ListMyOrganizationsFeatureResponse>(
            new ListMyOrganizationsFeature(user.userId),
        )
    }
}
