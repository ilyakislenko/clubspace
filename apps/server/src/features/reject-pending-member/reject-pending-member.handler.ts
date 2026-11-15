import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { assertCanManageRoles } from '../../shared/access/role-hierarchy'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RejectPendingMemberFeature,
    RejectPendingMemberFeatureResponse,
} from './reject-pending-member.feature'

@Feature(RejectPendingMemberFeature)
export class RejectPendingMemberHandler
    implements
        IFeatureHandler<
            RejectPendingMemberFeature,
            RejectPendingMemberFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly rbac: RbacService,
        private readonly joinRequests: JoinRequestService,
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: RejectPendingMemberFeature) {
        const ctx = await assertSportLead(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Отклонять заявки может только администратор клуба',
        )

        // The owner has no member row, so they simply match nothing.
        const pending = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId, userId, status: 'INVITED' },
            select: {
                id: true,
                role: { select: { name: true } },
                workspace: { select: { name: true } },
            },
        })
        if (!pending) {
            throw new NotFoundError({ message: 'Заявка не найдена' })
        }
        // A pending row holding a staff role is the club admins' call, as
        // approving it is (add-workspace-member).
        await assertCanManageRoles(
            this.prisma,
            ctx,
            { roleName, isSuperAdmin },
            [pending.role.name],
            (v) =>
                `Отклонить заявку ${v.coach.gen}, ${v.headCoach.gen} или администратора может только владелец или администратор клуба`,
        )

        // Keep the row as BLOCKED instead of deleting it: send-auth-code only
        // creates an INVITED row when none exists, so the applicant can't
        // re-apply and re-notify the owner. Scoped to INVITED so a stale list
        // (or a second staff member) can never touch an ACTIVE member.
        const { count } = await this.prisma.workspaceMember.updateMany({
            where: { workspaceId, userId, status: 'INVITED' },
            data: { status: 'BLOCKED' },
        })

        if (count === 0) {
            throw new NotFoundError({ message: 'Заявка не найдена' })
        }

        const comment = payload.comment || null
        await this.audit.record({
            action: 'member.rejectPending',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { comment },
        })

        this.realtime.invalidate(workspaceId, ['members', 'requests'])

        await this.joinRequests.notifyDeclined({
            userId,
            workspaceId,
            workspaceName: pending.workspace.name,
            membershipId: pending.id,
            comment,
        })

        return { status: 'rejected' as const }
    }
}
