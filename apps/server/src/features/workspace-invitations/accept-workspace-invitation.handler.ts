import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { WorkspaceInvitationService } from '../../domains/workspace/services/workspace-invitation.service'
import {
    AcceptWorkspaceInvitationFeature,
    AcceptWorkspaceInvitationFeatureResponse,
} from './accept-workspace-invitation.feature'

// Only the invited person can accept: the service looks the offer up by id
// AND the caller, so someone else's id is a plain 404.
@Feature(AcceptWorkspaceInvitationFeature)
export class AcceptWorkspaceInvitationHandler
    implements
        IFeatureHandler<
            AcceptWorkspaceInvitationFeature,
            AcceptWorkspaceInvitationFeatureResponse
        >
{
    constructor(
        private readonly invitations: WorkspaceInvitationService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        invitationId,
        invokerUserId,
    }: AcceptWorkspaceInvitationFeature): Promise<AcceptWorkspaceInvitationFeatureResponse> {
        const accepted = await this.invitations.accept({
            userId: invokerUserId,
            invitationId,
        })
        await this.audit.record({
            action: 'member.acceptInvitation',
            targetType: 'member',
            targetId: invokerUserId,
            workspaceId: accepted.workspaceId,
            actorId: invokerUserId,
            metadata: { via: 'app', role: accepted.roleName, groupId: accepted.groupId },
        })
        return accepted
    }
}
