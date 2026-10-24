import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
    ) {}

    async execute({
        workspaceId,
        userId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: RejectPendingMemberFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Отклонять заявки может только администратор клуба',
        )

        // Keep the row as BLOCKED instead of deleting it: send-auth-code only
        // creates an INVITED row when none exists, so the applicant can't
        // re-apply and re-notify the owner. Scoped to INVITED so a stale list
        // can never touch an ACTIVE member. The owner has no member row, so
        // they simply match nothing.
        const { count } = await this.prisma.workspaceMember.updateMany({
            where: { workspaceId, userId, status: 'INVITED' },
            data: { status: 'BLOCKED' },
        })

        if (count === 0) {
            throw new NotFoundError({ message: 'Заявка не найдена' })
        }

        await this.audit.record({
            action: 'member.rejectPending',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
        })

        this.realtime.invalidate(workspaceId, ['members'])

        return { status: 'rejected' as const }
    }
}
