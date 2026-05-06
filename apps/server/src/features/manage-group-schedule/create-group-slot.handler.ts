import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateGroupSlotFeature,
    CreateGroupSlotFeatureResponse,
} from './create-group-slot.feature'
import { serializeSlot } from './schemas'

@Feature(CreateGroupSlotFeature)
export class CreateGroupSlotHandler
    implements
        IFeatureHandler<CreateGroupSlotFeature, CreateGroupSlotFeatureResponse>
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
    }: CreateGroupSlotFeature) {
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

        // Reject overlap inside the same day. Comparing wall-clock minutes
        // since the slot is anchored to a single day-of-week — we don't
        // need a real interval-tree, just an O(n) scan over that day's
        // existing slots.
        const startMin = parseTimeToMinutes(payload.startTime)
        const endMin = startMin + payload.durationMin
        if (endMin > 24 * 60) {
            throw new BadRequestError({
                message: 'Slot crosses midnight — split into two slots',
            })
        }
        const sameDaySlots = await this.prisma.groupScheduleSlot.findMany({
            where: { groupId, dayOfWeek: payload.dayOfWeek },
            select: { startTime: true, durationMin: true },
        })
        for (const existing of sameDaySlots) {
            const existingStart = parseTimeToMinutes(existing.startTime)
            const existingEnd = existingStart + existing.durationMin
            if (startMin < existingEnd && existingStart < endMin) {
                throw new BadRequestError({
                    message:
                        'Slot overlaps with another slot on the same day',
                })
            }
        }

        const created = await this.prisma.groupScheduleSlot.create({
            data: {
                groupId,
                dayOfWeek: payload.dayOfWeek,
                startTime: payload.startTime,
                durationMin: payload.durationMin,
                effectiveFrom: payload.effectiveFrom
                    ? new Date(payload.effectiveFrom)
                    : null,
                effectiveUntil: payload.effectiveUntil
                    ? new Date(payload.effectiveUntil)
                    : null,
            },
        })

        await this.audit.record({
            action: 'group.slotCreate',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                slotId: created.id,
                dayOfWeek: created.dayOfWeek,
                startTime: created.startTime,
                durationMin: created.durationMin,
            },
        })

        return serializeSlot(created)
    }
}

const parseTimeToMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map((part) => parseInt(part, 10))
    return h * 60 + m
}
