import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { ClassBookingService } from '../../domains/class-bookings/class-booking.service'
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
        private readonly classBookings: ClassBookingService,
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

        // «Запись на занятие»: the slot's not-yet-held classes go away with
        // it — their booked members get places released and a push first.
        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId },
            select: { bookingMode: true },
        })
        if (group?.bookingMode === 'BOOKING') {
            await this.classBookings.cancelByClub({
                workspaceId,
                groupId,
                slotId,
                reason: null,
            })
        }

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
