import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListWorkspaceMembersFeature,
    ListWorkspaceMembersFeatureOutputSchema,
    ListWorkspaceMembersFeatureResponse,
} from './list-workspace-members.feature'

class ListWorkspaceMembersOutput extends createZodDto(
    ListWorkspaceMembersFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListWorkspaceMembersController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListWorkspaceMembersOutput })
    async listMembers(@Param('workspaceId') workspaceId: string) {
        return await this.bus.execute<
            ListWorkspaceMembersFeature,
            ListWorkspaceMembersFeatureResponse
        >(new ListWorkspaceMembersFeature(workspaceId))
    }
}
