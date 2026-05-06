import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteGroupExceptionFeature,
    DeleteGroupExceptionFeatureResponse,
} from './delete-group-exception.feature'

@Feature(DeleteGroupExceptionFeature)
export class DeleteGroupExceptionHandler
    implements
        IFeatureHandler<
            DeleteGroupExceptionFeature,
            DeleteGroupExceptionFeatureResponse
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
        exceptionId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: DeleteGroupExceptionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        await this.prisma.scheduleException.deleteMany({
            where: { id: exceptionId, groupId, group: { workspaceId } },
        })

        await this.audit.record({
            action: 'group.exceptionDelete',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { exceptionId },
        })

        return { status: 'deleted' as const }
    }
}
