import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { ClassBookingService } from '../../domains/class-bookings/class-booking.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    buildClassOccurrenceView,
    loadClassForStaff,
} from './class-occurrence-view'
import {
    SetClassCapacityFeature,
    SetClassCapacityFeatureResponse,
} from './set-class-capacity.feature'

// Spots of one dated class (e.g. a stand is broken this Tuesday).
@Feature(SetClassCapacityFeature)
export class SetClassCapacityHandler
    implements
        IFeatureHandler<SetClassCapacityFeature, SetClassCapacityFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly classBookings: ClassBookingService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: SetClassCapacityFeature) {
        const cls = await loadClassForStaff(this.rbac, this.classBookings, f, 'write')
        await this.classBookings.setOccurrenceCapacity({
            cls,
            capacity: f.payload.capacity,
        })
        await this.audit.record({
            action: 'booking.setCapacity',
            targetType: 'group',
            targetId: cls.group.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                slotId: cls.slot.id,
                sessionDate: cls.sessionDate,
                capacity: f.payload.capacity,
            },
        })
        return buildClassOccurrenceView(this.prisma, cls)
    }
}
