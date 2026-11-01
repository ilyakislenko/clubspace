import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ClassBookingService } from '../../domains/class-bookings/class-booking.service'
import {
    CancelClassBookingFeature,
    CancelClassBookingFeatureResponse,
} from './cancel-class-booking.feature'

// The member gives up their place / waitlist place (also: declines a place
// they got from the waitlist). Only their own booking; late cancels are
// recorded and burn per the club's setting.
@Feature(CancelClassBookingFeature)
export class CancelClassBookingHandler
    implements
        IFeatureHandler<
            CancelClassBookingFeature,
            CancelClassBookingFeatureResponse
        >
{
    constructor(private readonly classBookings: ClassBookingService) {}

    async execute(f: CancelClassBookingFeature) {
        return this.classBookings.cancelOwn({
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            bookingId: f.bookingId,
        })
    }
}
