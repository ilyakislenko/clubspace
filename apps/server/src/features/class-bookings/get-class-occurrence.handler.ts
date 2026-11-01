import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ClassBookingService } from '../../domains/class-bookings/class-booking.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    buildClassOccurrenceView,
    loadClassForStaff,
} from './class-occurrence-view'
import {
    GetClassOccurrenceFeature,
    GetClassOccurrenceFeatureResponse,
} from './get-class-occurrence.feature'

@Feature(GetClassOccurrenceFeature)
export class GetClassOccurrenceHandler
    implements
        IFeatureHandler<
            GetClassOccurrenceFeature,
            GetClassOccurrenceFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly classBookings: ClassBookingService,
    ) {}

    async execute(f: GetClassOccurrenceFeature) {
        const cls = await loadClassForStaff(this.rbac, this.classBookings, f, 'read')
        return buildClassOccurrenceView(this.prisma, cls)
    }
}
