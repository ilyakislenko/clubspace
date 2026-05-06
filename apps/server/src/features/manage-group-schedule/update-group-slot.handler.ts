import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeSlot } from './schemas'
import { crossesMidnight, slotsOverlap } from './slot-utils'
import {
    UpdateGroupSlotFeature,
    UpdateGroupSlotFeatureResponse,
} from './update-group-slot.feature'

@Feature(UpdateGroupSlotFeature)
export class UpdateGroupSlotHandler
    implements
        IFeatureHandler<UpdateGroupSlotFeature, UpdateGroupSlotFeatureResponse>
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
        slotId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: UpdateGroupSlotFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        const existing = await this.prisma.groupScheduleSlot.findFirst({
            where: { id: slotId, groupId, group: { workspaceId } },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Slot not found' })
        }

        const next = {
            dayOfWeek: payload.dayOfWeek ?? existing.dayOfWeek,
            startTime: payload.startTime ?? existing.startTime,
            durationMin: payload.durationMin ?? existing.durationMin,
        }
        if (crossesMidnight(next)) {
            throw new BadRequestError({
                message: 'Slot crosses midnight — split into two slots',
            })
        }

        // Same overlap check as create, but exclude self.
        const sameDaySlots = await this.prisma.groupScheduleSlot.findMany({
            where: {
                groupId,
                dayOfWeek: next.dayOfWeek,
                NOT: { id: slotId },
            },
            select: { startTime: true, durationMin: true },
        })
        for (const other of sameDaySlots) {
            if (slotsOverlap(next, other)) {
                throw new BadRequestError({
                    message:
                        'Slot overlaps with another slot on the same day',
                })
            }
        }

        const updated = await this.prisma.groupScheduleSlot.update({
            where: { id: slotId },
            data: {
                ...(payload.dayOfWeek !== undefined && {
                    dayOfWeek: payload.dayOfWeek,
                }),
                ...(payload.startTime !== undefined && {
                    startTime: payload.startTime,
                }),
                ...(payload.durationMin !== undefined && {
                    durationMin: payload.durationMin,
                }),
                ...(payload.effectiveFrom !== undefined && {
                    effectiveFrom: payload.effectiveFrom
                        ? new Date(payload.effectiveFrom)
                        : null,
                }),
                ...(payload.effectiveUntil !== undefined && {
                    effectiveUntil: payload.effectiveUntil
                        ? new Date(payload.effectiveUntil)
                        : null,
                }),
            },
        })

        await this.audit.record({
            action: 'group.slotUpdate',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { slotId, fields: Object.keys(payload) },
        })

        return serializeSlot(updated)
    }
}
