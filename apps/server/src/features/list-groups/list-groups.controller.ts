import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListGroupsFeature,
    ListGroupsFeatureOutputSchema,
    ListGroupsFeatureResponse,
} from './list-groups.feature'

class ListGroupsOutput extends createZodDto(ListGroupsFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListGroupsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListGroupsOutput })
    async listGroups(
        @Param('workspaceId') workspaceId: string,
        @Query('coachId') coachId?: string,
    ) {
        return await this.bus.execute<
            ListGroupsFeature,
            ListGroupsFeatureResponse
        >(new ListGroupsFeature(workspaceId, { coachId }))
    }
}
