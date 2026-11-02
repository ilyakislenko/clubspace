import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListEventRegistrationsFeature,
    ListEventRegistrationsFeatureResponse,
} from './list-event-registrations.feature'
import { byQueueOrder, serializeRegistrant, waitlistPositions } from './schemas'

const STATUS_ORDER = { BOOKED: 0, WAITLISTED: 1, CANCELLED: 2 } as const

// Who registered for an event and who paid — staff (any coach, like editing
// events); a member is refused by resolveCoachScope.
@Feature(ListEventRegistrationsFeature)
export class ListEventRegistrationsHandler
    implements
        IFeatureHandler<
            ListEventRegistrationsFeature,
            ListEventRegistrationsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListEventRegistrationsFeature) {
        await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const event = await this.prisma.workspaceEvent.findFirst({
            where: { id: f.eventId, workspaceId: f.workspaceId },
            select: { id: true, capacity: true, price: true, currency: true },
        })
        if (!event) throw new NotFoundError({ message: 'Событие не найдено' })

        const rows = await this.prisma.eventRegistration.findMany({
            where: { eventId: event.id },
            include: {
                user: { select: { firstname: true, lastname: true, email: true } },
            },
        })
        rows.sort(
            (a, b) =>
                STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
                byQueueOrder(a, b),
        )
        const positions = waitlistPositions(rows)
        const paid = rows.filter((r) => r.isPaid)
        // One line per member: an unpaid cancellation they since registered
        // over (or cancelled again later) says nothing new. A paid one stays —
        // the money is still to settle.
        const listed = rows.filter(
            (r) =>
                r.status !== 'CANCELLED' ||
                r.isPaid ||
                !rows.some(
                    (o) =>
                        o.id !== r.id &&
                        o.userId === r.userId &&
                        (o.status !== 'CANCELLED' || o.isPaid || o.createdAt > r.createdAt),
                ),
        )
        return {
            eventId: event.id,
            capacity: event.capacity,
            price: event.price,
            currency: event.currency,
            booked: rows.filter((r) => r.status === 'BOOKED').length,
            waitlist: positions.size,
            paid: {
                count: paid.length,
                amount: paid.reduce((sum, r) => sum + (r.amountPaid ?? 0), 0),
            },
            data: listed.map((r) => serializeRegistrant(r, positions.get(r.id) ?? null)),
        }
    }
}
