import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListGymsFeature,
    ListGymsFeatureOutputSchema,
    ListGymsFeatureResponse,
} from './list-gyms.feature'

class ListGymsOutput extends createZodDto(ListGymsFeatureOutputSchema) {}

// No RoleGuard — mobile students need to see club gyms in the "Залы"
// screen. Gym name + address is not sensitive (it's where they go to
// class). The endpoint deliberately does not return inner details
// (group counts are public agg, no member emails).
@Controller('workspaces/:workspaceId/gyms')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListGymsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListGymsOutput })
    async listGyms(@Param('workspaceId') workspaceId: string) {
        return await this.bus.execute<ListGymsFeature, ListGymsFeatureResponse>(
            new ListGymsFeature(workspaceId),
        )
    }
}
