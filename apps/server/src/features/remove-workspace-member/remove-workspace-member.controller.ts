import { Controller, Delete, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    RemoveWorkspaceMemberFeature,
    RemoveWorkspaceMemberFeatureOutputSchema,
    RemoveWorkspaceMemberFeatureResponse,
} from './remove-workspace-member.feature'

class RemoveWorkspaceMemberOutput extends createZodDto(
    RemoveWorkspaceMemberFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class RemoveWorkspaceMemberController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':userId')
    @ZodResponse({ type: RemoveWorkspaceMemberOutput })
    async removeMember(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RemoveWorkspaceMemberFeature,
            RemoveWorkspaceMemberFeatureResponse
        >(new RemoveWorkspaceMemberFeature(workspaceId, userId, user.userId))
    }
}
