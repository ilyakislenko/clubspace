import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
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
    ) {}

    async execute({
        workspaceId,
        groupId,
        userId,
        invokerUserId,
    }: RemoveGroupMemberFeature) {
        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId },
            select: { id: true },
        })

        if (!group) throw new NotFoundError({ message: 'Group not found' })

        await this.prisma.groupMember
            .delete({
                where: { groupId_userId: { groupId, userId } },
            })
            .catch(() => {
                // Idempotent — removing someone who's not in the group is
                // fine; the UI may issue duplicate requests if the user
                // double-taps.
            })

        await this.audit.record({
            action: 'group.remove_member',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { userId },
        })

        return { status: 'removed' as const }
    }
}
