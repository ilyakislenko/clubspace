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
    RemoveClassBookingFeature,
    RemoveClassBookingFeatureResponse,
} from './remove-class-booking.feature'

// Staff take a member off a class (no burn); the waitlist moves up.
@Feature(RemoveClassBookingFeature)
export class RemoveClassBookingHandler
    implements
        IFeatureHandler<
            RemoveClassBookingFeature,
            RemoveClassBookingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly classBookings: ClassBookingService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: RemoveClassBookingFeature) {
        const cls = await loadClassForStaff(this.rbac, this.classBookings, f, 'write')
        await this.classBookings.removeByStaff({ cls, bookingId: f.bookingId })
        await this.audit.record({
            action: 'booking.staffRemove',
            targetType: 'group',
            targetId: cls.group.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                slotId: cls.slot.id,
                sessionDate: cls.sessionDate,
                bookingId: f.bookingId,
            },
        })
        return buildClassOccurrenceView(this.prisma, cls)
    }
}
