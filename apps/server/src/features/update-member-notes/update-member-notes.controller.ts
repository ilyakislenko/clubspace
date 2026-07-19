import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    UpdateMemberNotesFeature,
    UpdateMemberNotesFeatureInputSchema,
    UpdateMemberNotesFeatureOutputSchema,
    UpdateMemberNotesFeatureResponse,
} from './update-member-notes.feature'

class UpdateMemberNotesBody extends createZodDto(
    UpdateMemberNotesFeatureInputSchema,
) {}

class UpdateMemberNotesOutput extends createZodDto(
    UpdateMemberNotesFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class UpdateMemberNotesController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':userId/notes')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: UpdateMemberNotesOutput })
    async updateNotes(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Body() body: UpdateMemberNotesBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateMemberNotesFeature,
            UpdateMemberNotesFeatureResponse
        >(
            new UpdateMemberNotesFeature(
                body,
                workspaceId,
                userId,
                user.userId,
            ),
        )
    }
}
