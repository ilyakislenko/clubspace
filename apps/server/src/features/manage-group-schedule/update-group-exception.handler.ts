import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeException } from './schemas'
import {
    UpdateGroupExceptionFeature,
    UpdateGroupExceptionFeatureResponse,
} from './update-group-exception.feature'

@Feature(UpdateGroupExceptionFeature)
export class UpdateGroupExceptionHandler
    implements
        IFeatureHandler<
            UpdateGroupExceptionFeature,
            UpdateGroupExceptionFeatureResponse
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
        exceptionId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: UpdateGroupExceptionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        const existing = await this.prisma.scheduleException.findFirst({
            where: { id: exceptionId, groupId, group: { workspaceId } },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Исключение в расписании не найдено' })
        }

        const fromDate = payload.fromDate
            ? new Date(payload.fromDate)
            : existing.fromDate
        const untilDate = payload.untilDate
            ? new Date(payload.untilDate)
            : existing.untilDate
        if (fromDate > untilDate) {
            throw new BadRequestError({
                message: 'Дата «с» должна быть не позже даты «по»',
            })
        }

        if (payload.slotId !== undefined && payload.slotId !== null) {
            const slot = await this.prisma.groupScheduleSlot.findFirst({
                where: { id: payload.slotId, groupId },
                select: { id: true },
            })
            if (!slot) {
                throw new NotFoundError({
                    message: 'Слот расписания не найден в этой группе',
                })
            }
        }

        const updated = await this.prisma.scheduleException.update({
            where: { id: exceptionId },
            data: {
                ...(payload.slotId !== undefined && {
                    slotId: payload.slotId,
                }),
                ...(payload.fromDate !== undefined && { fromDate }),
                ...(payload.untilDate !== undefined && { untilDate }),
                ...(payload.reason !== undefined && {
                    reason: payload.reason,
                }),
            },
        })

        await this.audit.record({
            action: 'group.exceptionUpdate',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { exceptionId, fields: Object.keys(payload) },
        })

        return serializeException(updated)
    }
}
