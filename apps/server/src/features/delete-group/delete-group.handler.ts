import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteGroupFeature,
    DeleteGroupFeatureResponse,
} from './delete-group.feature'

@Feature(DeleteGroupFeature)
export class DeleteGroupHandler
    implements IFeatureHandler<DeleteGroupFeature, DeleteGroupFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        groupId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: DeleteGroupFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)
        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId },
            select: { id: true, name: true, gymId: true, coachId: true },
        })

        if (!group) {
            throw new NotFoundError({ message: 'Группа не найдена' })
        }

        // GroupMember rows cascade away via onDelete: Cascade in the schema.
        await this.prisma.group.delete({ where: { id: groupId } })

        await this.audit.record({
            action: 'group.delete',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { name: group.name },
        })

        return { status: 'deleted' as const }
    }
}
