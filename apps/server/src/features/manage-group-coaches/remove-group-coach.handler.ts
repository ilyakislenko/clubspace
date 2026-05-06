import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RemoveGroupCoachFeature,
    RemoveGroupCoachFeatureResponse,
} from './remove-group-coach.feature'

@Feature(RemoveGroupCoachFeature)
export class RemoveGroupCoachHandler
    implements
        IFeatureHandler<RemoveGroupCoachFeature, RemoveGroupCoachFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        groupId,
        userId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: RemoveGroupCoachFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        // Refuse to drop the primary — the lead coach is canonical and
        // changes via update-group's coachId field, not here. This keeps
        // the invariant that every group has exactly one primary row.
        const existing = await this.prisma.groupCoach.findUnique({
            where: { groupId_userId: { groupId, userId } },
            select: { role: true },
        })
        if (!existing) {
            // Idempotent — if they aren't there, there's nothing to do.
            return { status: 'removed' as const }
        }
        if (existing.role === 'primary') {
            throw new BadRequestError({
                message:
                    'Cannot remove primary coach — change them via the group form',
            })
        }

        await this.prisma.groupCoach.delete({
            where: { groupId_userId: { groupId, userId } },
        })

        await this.audit.record({
            action: 'group.update',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { removed: { userId, role: existing.role } },
        })

        return { status: 'removed' as const }
    }
}
