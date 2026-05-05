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
    RemoveGroupMemberFeature,
    RemoveGroupMemberFeatureOutputSchema,
    RemoveGroupMemberFeatureResponse,
} from './remove-group-member.feature'

class RemoveGroupMemberOutput extends createZodDto(
    RemoveGroupMemberFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class RemoveGroupMemberController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':groupId/members/:userId')
    @ZodResponse({ type: RemoveGroupMemberOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RemoveGroupMemberFeature,
            RemoveGroupMemberFeatureResponse
        >(
            new RemoveGroupMemberFeature(
                workspaceId,
                groupId,
                userId,
                user.userId,
            ),
        )
    }
}
