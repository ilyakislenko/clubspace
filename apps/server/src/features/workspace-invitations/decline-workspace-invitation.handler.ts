import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { WorkspaceInvitationService } from '../../domains/workspace/services/workspace-invitation.service'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    DeclineWorkspaceInvitationFeature,
    DeclineWorkspaceInvitationFeatureResponse,
} from './decline-workspace-invitation.feature'

// The invited person turns the offer down; the club may invite again later.
@Feature(DeclineWorkspaceInvitationFeature)
export class DeclineWorkspaceInvitationHandler
    implements
        IFeatureHandler<
            DeclineWorkspaceInvitationFeature,
            DeclineWorkspaceInvitationFeatureResponse
        >
{
    constructor(
        private readonly invitations: WorkspaceInvitationService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        invitationId,
        invokerUserId,
    }: DeclineWorkspaceInvitationFeature): Promise<DeclineWorkspaceInvitationFeatureResponse> {
        const removed = await this.invitations.remove({
            id: invitationId,
            userId: invokerUserId,
        })
        if (!removed) {
            throw new NotFoundError({ message: 'Приглашение не найдено' })
        }
        await this.audit.record({
            action: 'member.declineInvitation',
            targetType: 'member',
            targetId: invokerUserId,
            workspaceId: removed.workspaceId,
            actorId: invokerUserId,
        })
        return { status: 'declined' as const }
    }
}
