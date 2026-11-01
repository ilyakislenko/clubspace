import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { ClassBookingService } from '../../domains/class-bookings/class-booking.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AddClassBookingFeature,
    AddClassBookingFeatureResponse,
} from './add-class-booking.feature'
import {
    buildClassOccurrenceView,
    loadClassForStaff,
} from './class-occurrence-view'

// Staff put a member into a class — over the capacity when it is full.
@Feature(AddClassBookingFeature)
export class AddClassBookingHandler
    implements
        IFeatureHandler<AddClassBookingFeature, AddClassBookingFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly classBookings: ClassBookingService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: AddClassBookingFeature) {
        const cls = await loadClassForStaff(this.rbac, this.classBookings, f, 'write')
        await this.classBookings.addByStaff({
            cls,
            userId: f.payload.userId,
            actorId: f.invokerUserId,
        })
        await this.audit.record({
            action: 'booking.staffAdd',
            targetType: 'group',
            targetId: cls.group.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                slotId: cls.slot.id,
                sessionDate: cls.sessionDate,
                userId: f.payload.userId,
            },
        })
        return buildClassOccurrenceView(this.prisma, cls)
    }
}
