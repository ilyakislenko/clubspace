import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { STAFF_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListGymsFeature,
    ListGymsFeatureOutputSchema,
    ListGymsFeatureResponse,
} from './list-gyms.feature'

class ListGymsOutput extends createZodDto(ListGymsFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/gyms')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListGymsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListGymsOutput })
    async listGyms(@Param('workspaceId') workspaceId: string) {
        return await this.bus.execute<ListGymsFeature, ListGymsFeatureResponse>(
            new ListGymsFeature(workspaceId),
        )
    }
}
