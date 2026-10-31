import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { assertCanManageRoles } from '../../shared/access/role-hierarchy'
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
        const ctx = await assertWorkspaceAdmin(
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

        const member = await this.prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId } },
            select: { role: { select: { name: true } } },
        })
        if (!member) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }

        // An expired access date shuts a member out of the club, so cutting
        // off an admin or head coach is reserved for the top of the club.
        assertCanManageRoles(
            ctx,
            { roleName, isSuperAdmin },
            [member.role.name],
            'Менять доступ администратора или старшего тренера может только владелец или администратор клуба',
        )

        const accessUntil =
            payload.accessUntil === null ? null : new Date(payload.accessUntil)

        const updated = await this.prisma.workspaceMember.update({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            data: { accessUntil },
            select: { userId: true, accessUntil: true },
        })

        // An explicit date is final: ending a freeze later must not rewrite it.
        await this.prisma.subscriptionFreeze.updateMany({
            where: { workspaceId, userId, accessShifted: true },
            data: { accessShifted: false },
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
