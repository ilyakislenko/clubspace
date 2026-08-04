import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RemoveWorkspaceMemberFeature,
    RemoveWorkspaceMemberFeatureResponse,
} from './remove-workspace-member.feature'

@Feature(RemoveWorkspaceMemberFeature)
export class RemoveWorkspaceMemberHandler
    implements
        IFeatureHandler<
            RemoveWorkspaceMemberFeature,
            RemoveWorkspaceMemberFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        userId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: RemoveWorkspaceMemberFeature) {
        // The route declares @Roles(WORKSPACE_ADMINS); comparing ownerId
        // directly here contradicted that and locked out admins/head_coaches
        // (and the platform super admin, who is never a member) while the UI
        // still offered them the control.
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Only workspace admins can remove members',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }


        if (userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'Cannot remove workspace owner',
            })
        }

        const member = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            select: { id: true },
        })

        if (!member) {
            throw new NotFoundError({ message: 'Member not found' })
        }

        await this.prisma.workspaceMember.delete({
            where: { id: member.id },
        })

        await this.audit.record({
            action: 'member.remove',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
        })

        this.realtime.invalidate(workspaceId, ['members'])

        return { status: 'removed' as const }
    }
}
