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
            'Удалять участников может только администратор клуба',
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
                message: 'Нельзя удалить владельца клуба',
            })
        }

        const member = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            select: { id: true },
        })

        if (!member) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.workspaceMember.delete({
                where: { id: member.id },
            })
            // Guest bookings are a member's privilege: they go with the membership.
            await tx.dropInBooking.deleteMany({
                where: { workspaceId, userId },
            })
            // Rosters and class reminders read these, so a removed member must
            // leave this club's groups too (other clubs' groups are untouched).
            // Assistant-coach rows go as well; the primary coach row mirrors
            // Group.coachId, which is a separate reassignment.
            await tx.groupMember.deleteMany({
                where: { userId, group: { workspaceId } },
            })
            await tx.groupCoach.deleteMany({
                where: { userId, role: 'assistant', group: { workspaceId } },
            })
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
