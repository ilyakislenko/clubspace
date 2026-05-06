import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetWorkspaceScheduleFeature,
    GetWorkspaceScheduleFeatureInputSchema,
    GetWorkspaceScheduleFeatureOutputSchema,
    GetWorkspaceScheduleFeatureResponse,
} from './get-workspace-schedule.feature'

class GetWorkspaceScheduleQuery extends createZodDto(
    GetWorkspaceScheduleFeatureInputSchema,
) {}

class GetWorkspaceScheduleOutput extends createZodDto(
    GetWorkspaceScheduleFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/schedule')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GetWorkspaceScheduleController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetWorkspaceScheduleOutput })
    async getSchedule(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetWorkspaceScheduleQuery,
    ) {
        return await this.bus.execute<
            GetWorkspaceScheduleFeature,
            GetWorkspaceScheduleFeatureResponse
        >(new GetWorkspaceScheduleFeature(query, workspaceId))
    }
}
