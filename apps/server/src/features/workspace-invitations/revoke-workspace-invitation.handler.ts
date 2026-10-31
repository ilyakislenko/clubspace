import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { WorkspaceInvitationService } from '../../domains/workspace/services/workspace-invitation.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RevokeWorkspaceInvitationFeature,
    RevokeWorkspaceInvitationFeatureResponse,
} from './revoke-workspace-invitation.feature'

// The club withdraws an offer that is still waiting. Scoped to the club, so
// another club's invitation id is a 404.
@Feature(RevokeWorkspaceInvitationFeature)
export class RevokeWorkspaceInvitationHandler
    implements
        IFeatureHandler<
            RevokeWorkspaceInvitationFeature,
            RevokeWorkspaceInvitationFeatureResponse
        >
{
    constructor(
        private readonly invitations: WorkspaceInvitationService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        invitationId,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: RevokeWorkspaceInvitationFeature): Promise<RevokeWorkspaceInvitationFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Отзывать приглашения может только администратор клуба',
        )
        const removed = await this.invitations.remove({
            id: invitationId,
            workspaceId,
        })
        if (!removed) {
            throw new NotFoundError({ message: 'Приглашение не найдено' })
        }
        await this.audit.record({
            action: 'member.revokeInvitation',
            targetType: 'member',
            targetId: removed.userId,
            workspaceId,
            actorId: invokerUserId,
        })
        return { status: 'revoked' as const }
    }
}
