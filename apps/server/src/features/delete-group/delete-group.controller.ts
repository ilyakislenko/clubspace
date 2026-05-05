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
    DeleteGroupFeature,
    DeleteGroupFeatureOutputSchema,
    DeleteGroupFeatureResponse,
} from './delete-group.feature'

class DeleteGroupOutput extends createZodDto(DeleteGroupFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/groups')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class DeleteGroupController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':groupId')
    @ZodResponse({ type: DeleteGroupOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteGroupFeature,
            DeleteGroupFeatureResponse
        >(new DeleteGroupFeature(workspaceId, groupId, user.userId))
    }
}
