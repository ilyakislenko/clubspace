import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMemberProgressFeature,
    GetMemberProgressFeatureOutputSchema,
    GetMemberProgressFeatureResponse,
} from './get-member-progress.feature'

class GetMemberProgressOutput extends createZodDto(
    GetMemberProgressFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members/:userId')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class GetMemberProgressController {
    constructor(private bus: FeaturesBus) {}

    @Get('progress')
    @ZodResponse({ type: GetMemberProgressOutput })
    async getProgress(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
    ) {
        return await this.bus.execute<
            GetMemberProgressFeature,
            GetMemberProgressFeatureResponse
        >(new GetMemberProgressFeature(workspaceId, userId))
    }
}
