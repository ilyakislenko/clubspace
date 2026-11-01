import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    ClassBookingService,
    type LoadedClass,
} from '../../domains/class-bookings/class-booking.service'
import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import {
    GetMyClassBookingsFeature,
    GetMyClassBookingsFeatureResponse,
} from './get-my-class-bookings.feature'

const HISTORY_DAYS = 60
const MAX_ROWS = 100

@Feature(GetMyClassBookingsFeature)
export class GetMyClassBookingsHandler
    implements
        IFeatureHandler<
            GetMyClassBookingsFeature,
            GetMyClassBookingsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly classBookings: ClassBookingService,
    ) {}

    async execute({ workspaceId, invokerUserId }: GetMyClassBookingsFeature) {
        const now = new Date()
        const rows = await this.prisma.classBooking.findMany({
            where: {
                workspaceId,
                userId: invokerUserId,
                occurrence: {
                    startAt: {
                        gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000),
                    },
                },
            },
            include: {
                occurrence: { select: { slotId: true, sessionDate: true } },
            },
            orderBy: [{ occurrence: { startAt: 'asc' } }, { createdAt: 'asc' }],
            take: MAX_ROWS,
        })
        const classes = new Map<string, LoadedClass>()
        const upcoming: GetMyClassBookingsFeatureResponse['upcoming'] = []
        const history: GetMyClassBookingsFeatureResponse['history'] = []
        for (const b of rows) {
            const key = `${b.occurrence.slotId}:${dbDateToYmd(b.occurrence.sessionDate)}`
            let cls = classes.get(key)
            if (!cls) {
                cls = await this.classBookings.loadClass(
                    workspaceId,
                    b.occurrence.slotId,
                    dbDateToYmd(b.occurrence.sessionDate),
                )
                classes.set(key, cls)
            }
            const view = await this.classBookings.view(cls, b, now)
            const live = b.status === 'BOOKED' || b.status === 'WAITLISTED'
            if (live && cls.occ.endAt.getTime() > now.getTime()) upcoming.push(view)
            else history.push(view)
        }
        history.reverse()
        return { upcoming, history }
    }
}
