import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteGroupSlotFeature,
    DeleteGroupSlotFeatureResponse,
} from './delete-group-slot.feature'

@Feature(DeleteGroupSlotFeature)
export class DeleteGroupSlotHandler
    implements
        IFeatureHandler<DeleteGroupSlotFeature, DeleteGroupSlotFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        groupId,
        slotId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: DeleteGroupSlotFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        // Idempotent on the row layer — a re-fired delete after a network
        // blip silently succeeds. The workspace + group filters in WHERE
        // keep the call from reaching another workspace's data.
        await this.prisma.groupScheduleSlot.deleteMany({
            where: { id: slotId, groupId, group: { workspaceId } },
        })

        await this.audit.record({
            action: 'group.slotDelete',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { slotId },
        })

        return { status: 'deleted' as const }
    }
}
