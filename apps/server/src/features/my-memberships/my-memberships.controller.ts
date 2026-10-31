import {
    Body,
    Controller,
    Delete,
    Param,
    ParseUUIDPipe,
    Patch,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    LeaveWorkspaceFeature,
    LeaveWorkspaceFeatureOutputSchema,
    type LeaveWorkspaceFeatureResponse,
} from './leave-workspace.feature'
import {
    UpdateMembershipNotificationsFeature,
    UpdateMembershipNotificationsInputSchema,
    UpdateMembershipNotificationsOutputSchema,
    type UpdateMembershipNotificationsFeatureResponse,
} from './update-membership-notifications.feature'

class LeaveWorkspaceOutput extends createZodDto(LeaveWorkspaceFeatureOutputSchema) {}
class UpdateMembershipNotificationsBody extends createZodDto(
    UpdateMembershipNotificationsInputSchema,
) {}
class UpdateMembershipNotificationsOutput extends createZodDto(
    UpdateMembershipNotificationsOutputSchema,
) {}

// The caller's own memberships. AuthGuard only: the handlers act on the
// caller's own row and refuse when there is none, and leaving must work even
// when the club's access window has lapsed. The param is `clubId`, not
// `workspaceId`, on purpose: AuthGuard resolves a role for a `workspaceId`
// param and would answer a non-member with its own 403 before the handler.
@Controller('me/memberships')
@UseGuards(AuthGuard)
export class MyMembershipsController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':clubId')
    @ZodResponse({ type: LeaveWorkspaceOutput })
    async leaveWorkspace(
        @Param('clubId', ParseUUIDPipe) workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            LeaveWorkspaceFeature,
            LeaveWorkspaceFeatureResponse
        >(new LeaveWorkspaceFeature(workspaceId, user.userId))
    }

    @Patch(':clubId/notifications')
    @ZodResponse({ type: UpdateMembershipNotificationsOutput })
    async updateMembershipNotifications(
        @Param('clubId', ParseUUIDPipe) workspaceId: string,
        @Body() body: UpdateMembershipNotificationsBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateMembershipNotificationsFeature,
            UpdateMembershipNotificationsFeatureResponse
        >(new UpdateMembershipNotificationsFeature(body, workspaceId, user.userId))
    }
}
