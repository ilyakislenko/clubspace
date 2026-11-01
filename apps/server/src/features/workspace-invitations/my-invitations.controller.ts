import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
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
    AcceptWorkspaceInvitationFeature,
    AcceptWorkspaceInvitationOutputSchema,
    type AcceptWorkspaceInvitationFeatureResponse,
} from './accept-workspace-invitation.feature'
import {
    DeclineWorkspaceInvitationFeature,
    DeclineWorkspaceInvitationOutputSchema,
    type DeclineWorkspaceInvitationFeatureResponse,
} from './decline-workspace-invitation.feature'
import {
    ListMyInvitationsFeature,
    ListMyInvitationsOutputSchema,
    type ListMyInvitationsFeatureResponse,
} from './list-my-invitations.feature'

class ListMyInvitationsOutput extends createZodDto(ListMyInvitationsOutputSchema) {}
class AcceptWorkspaceInvitationOutput extends createZodDto(
    AcceptWorkspaceInvitationOutputSchema,
) {}
class DeclineWorkspaceInvitationOutput extends createZodDto(
    DeclineWorkspaceInvitationOutputSchema,
) {}

// AuthGuard only, no WorkspaceMemberGuard: these are clubs the caller is NOT a
// member of yet. The handlers match the offer on the caller.
@Controller('me/invitations')
@UseGuards(AuthGuard)
export class MyInvitationsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyInvitationsOutput })
    async listMyInvitations(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            ListMyInvitationsFeature,
            ListMyInvitationsFeatureResponse
        >(new ListMyInvitationsFeature(user.userId))
    }

    @Post(':invitationId/accept')
    @ZodResponse({ type: AcceptWorkspaceInvitationOutput })
    async acceptWorkspaceInvitation(
        @Param('invitationId', ParseUUIDPipe) invitationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AcceptWorkspaceInvitationFeature,
            AcceptWorkspaceInvitationFeatureResponse
        >(new AcceptWorkspaceInvitationFeature(invitationId, user.userId))
    }

    @Post(':invitationId/decline')
    @ZodResponse({ type: DeclineWorkspaceInvitationOutput })
    async declineWorkspaceInvitation(
        @Param('invitationId', ParseUUIDPipe) invitationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeclineWorkspaceInvitationFeature,
            DeclineWorkspaceInvitationFeatureResponse
        >(new DeclineWorkspaceInvitationFeature(invitationId, user.userId))
    }
}
