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
    UpdateWorkspaceMemberAccessFeature,
    UpdateWorkspaceMemberAccessFeatureResponse,
} from './update-workspace-member-access.feature'

@Feature(UpdateWorkspaceMemberAccessFeature)
export class UpdateWorkspaceMemberAccessHandler
    implements
        IFeatureHandler<
            UpdateWorkspaceMemberAccessFeature,
            UpdateWorkspaceMemberAccessFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: UpdateWorkspaceMemberAccessFeature) {
        // The route declares @Roles(WORKSPACE_ADMINS), but this handler used to
        // compare ownerId directly and refuse everyone else — so an 'admin' or
        // 'head_coach' (and the platform super admin, who is never a member)
        // saw the control in the UI and got a 403 on save. Go through the same
        // scope resolution as every other admin action.
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Менять доступ участника может только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        if (userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'У владельца клуба доступ бессрочный',
            })
        }

        const accessUntil =
            payload.accessUntil === null ? null : new Date(payload.accessUntil)

        const updated = await this.prisma.workspaceMember.update({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            data: { accessUntil },
            select: { userId: true, accessUntil: true },
        })

        await this.audit.record({
            action: 'member.updateAccess',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                accessUntil: updated.accessUntil
                    ? updated.accessUntil.toISOString()
                    : null,
            },
        })

        // Refresh the admin roster and the member's own subscription/access view.
        this.realtime.invalidate(workspaceId, ['members', 'subscription'])

        return {
            userId: updated.userId,
            accessUntil: updated.accessUntil
                ? updated.accessUntil.toISOString()
                : null,
        }
    }
}
