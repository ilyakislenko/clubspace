import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RemoveGroupMemberFeature,
    RemoveGroupMemberFeatureResponse,
} from './remove-group-member.feature'

@Feature(RemoveGroupMemberFeature)
export class RemoveGroupMemberHandler
    implements
        IFeatureHandler<
            RemoveGroupMemberFeature,
            RemoveGroupMemberFeatureResponse
        >
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
    }: RemoveGroupMemberFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)
        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId },
            select: { id: true },
        })

        if (!group) throw new NotFoundError({ message: 'Group not found' })

        // Idempotent — removing someone who's not in the group is fine
        // (the UI may issue duplicate requests if the user double-taps).
        // We deliberately only swallow Prisma's "record not found" error
        // (P2025); a connection failure or FK error must still bubble up
        // so the client doesn't believe a non-removal succeeded.
        try {
            await this.prisma.groupMember.delete({
                where: { groupId_userId: { groupId, userId } },
            })
        } catch (err) {
            const code = (err as { code?: string } | null)?.code
            if (code !== 'P2025') throw err
        }

        await this.audit.record({
            action: 'group.removeMember',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { userId },
        })

        return { status: 'removed' as const }
    }
}
