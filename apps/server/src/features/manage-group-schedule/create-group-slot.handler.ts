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
import { crossesMidnight, slotsOverlap } from './slot-utils'

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
        if (!group) throw new NotFoundError({ message: 'Группа не найдена' })

        // Reject overlap inside the same day. Comparing wall-clock minutes
        // since the slot is anchored to a single day-of-week — we don't
        // need a real interval-tree, just an O(n) scan over that day's
        // existing slots.
        const candidate = {
            startTime: payload.startTime,
            durationMin: payload.durationMin,
        }
        if (crossesMidnight(candidate)) {
            throw new BadRequestError({
                message: 'Слот пересекает полночь — разбейте его на два',
            })
        }
        const sameDaySlots = await this.prisma.groupScheduleSlot.findMany({
            where: { groupId, dayOfWeek: payload.dayOfWeek },
            select: { startTime: true, durationMin: true },
        })
        for (const existing of sameDaySlots) {
            if (slotsOverlap(candidate, existing)) {
                throw new BadRequestError({
                    message:
                        'Слот пересекается с другим в тот же день',
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

