import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { assertCanManageRoles } from '../../shared/access/role-hierarchy'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { purgeMembership } from './purge-membership'
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
        private readonly eventRegistrations: EventRegistrationService,
    ) {}

    async execute({
        workspaceId,
        userId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: RemoveWorkspaceMemberFeature) {
        // The route declares @Roles(SPORT_LEADS); comparing ownerId
        // directly here contradicted that and locked out admins/head_coaches
        // (and the platform super admin, who is never a member) while the UI
        // still offered them the control.
        const ctx = await assertSportLead(
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
            select: { id: true, role: { select: { name: true } } },
        })

        if (!member) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }

        // A sport lead removes students and parents; staff are the club admins' call.
        await assertCanManageRoles(
            this.prisma,
            ctx,
            { roleName, isSuperAdmin },
            [member.role.name],
            (v) =>
                `Удалить ${v.coach.acc}, ${v.headCoach.acc} или администратора может только владелец или администратор клуба`,
        )

        const { freedEventIds } = await this.prisma.$transaction((tx) =>
            purgeMembership(tx, {
                memberId: member.id,
                userId,
                workspaceId,
                now: new Date(),
            }),
        )
        await this.eventRegistrations.promoteFreed(workspaceId, freedEventIds)

        await this.audit.record({
            action: 'member.remove',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
        })

        this.realtime.invalidate(workspaceId, ['members', 'freeze-requests', 'requests'])
        // Their open sockets stop receiving this club's events right away.
        this.realtime.leaveWorkspaceRoom([userId], workspaceId)

        return { status: 'removed' as const }
    }
}
