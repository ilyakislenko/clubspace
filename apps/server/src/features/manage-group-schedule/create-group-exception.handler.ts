import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateGroupExceptionFeature,
    CreateGroupExceptionFeatureResponse,
} from './create-group-exception.feature'
import { serializeException } from './schemas'

@Feature(CreateGroupExceptionFeature)
export class CreateGroupExceptionHandler
    implements
        IFeatureHandler<
            CreateGroupExceptionFeature,
            CreateGroupExceptionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        groupId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: CreateGroupExceptionFeature) {
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

        // If the caller pinned the exception to a specific slot, that slot
        // must belong to this group — otherwise a malicious request could
        // skip a slot from another group.
        if (payload.slotId) {
            const slot = await this.prisma.groupScheduleSlot.findFirst({
                where: { id: payload.slotId, groupId },
                select: { id: true },
            })
            if (!slot) {
                throw new NotFoundError({
                    message: 'Slot not found in this group',
                })
            }
        }

        const created = await this.prisma.scheduleException.create({
            data: {
                groupId,
                slotId: payload.slotId ?? null,
                fromDate: new Date(payload.fromDate),
                untilDate: new Date(payload.untilDate),
                reason: payload.reason ?? null,
            },
        })

        await this.audit.record({
            action: 'group.exceptionCreate',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                exceptionId: created.id,
                slotId: created.slotId,
                fromDate: payload.fromDate,
                untilDate: payload.untilDate,
                reason: created.reason,
            },
        })

        return serializeException(created)
    }
}
