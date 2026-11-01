import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ClassBookingService } from '../../domains/class-bookings/class-booking.service'
import {
    BookClassFeature,
    BookClassFeatureResponse,
} from './book-class.feature'

// Any active member books a class of a «Запись на занятие» group (a guardian
// for a child via X-Act-As): a place, or a waitlist place when it's full. All
// rules live in ClassBookingService.book.
@Feature(BookClassFeature)
export class BookClassHandler
    implements IFeatureHandler<BookClassFeature, BookClassFeatureResponse>
{
    constructor(private readonly classBookings: ClassBookingService) {}

    async execute(f: BookClassFeature) {
        return this.classBookings.book({
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            actorId: f.actorUserId,
            slotId: f.payload.slotId,
            sessionDate: f.payload.sessionDate,
        })
    }
}
