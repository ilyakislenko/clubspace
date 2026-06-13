import {
    Body,
    Controller,
    Delete,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AddGroupCoachFeature,
    AddGroupCoachFeatureInputSchema,
    AddGroupCoachFeatureOutputSchema,
    type AddGroupCoachFeatureResponse,
} from './add-group-coach.feature'
import {
    RemoveGroupCoachFeature,
    RemoveGroupCoachFeatureOutputSchema,
    type RemoveGroupCoachFeatureResponse,
} from './remove-group-coach.feature'

class AddGroupCoachInput extends createZodDto(
    AddGroupCoachFeatureInputSchema,
) {}
class AddGroupCoachOutput extends createZodDto(
    AddGroupCoachFeatureOutputSchema,
) {}
class RemoveGroupCoachOutput extends createZodDto(
    RemoveGroupCoachFeatureOutputSchema,
) {}

// Per-row write permission is enforced inside each handler via
// RbacService.assertCanWriteGroup, so the controller only needs the
// workspace-member gate.
@Controller('workspaces/:workspaceId/groups/:groupId/coaches')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class GroupCoachesController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: AddGroupCoachOutput })
    async add(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Body() body: AddGroupCoachInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddGroupCoachFeature,
            AddGroupCoachFeatureResponse
        >(
            new AddGroupCoachFeature(
                body,
                workspaceId,
                groupId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':userId')
    @ZodResponse({ type: RemoveGroupCoachOutput })
    async remove(
        @Param('workspaceId') workspaceId: string,
        @Param('groupId') groupId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RemoveGroupCoachFeature,
            RemoveGroupCoachFeatureResponse
        >(
            new RemoveGroupCoachFeature(
                workspaceId,
                groupId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
