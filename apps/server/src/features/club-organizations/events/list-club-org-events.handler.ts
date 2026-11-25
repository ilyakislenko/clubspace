import { Feature, IFeatureHandler } from '@shelfjs/features'

import { bookedCounts } from '../../../domains/organizations/org-events'
import { PrismaService } from '../../../infrastructure/prisma'
import { clubOrgEventsWhere, CLUB_ORG_EVENT_SELECT, isClubStaff } from './club-org-events'
import {
    ListClubOrgEventsFeature,
    ListClubOrgEventsFeatureResponse,
} from './list-club-org-events.feature'
import { serializeClubOrgEvent } from './schemas'

// Upcoming federation events in the app's «События» (until they end).
@Feature(ListClubOrgEventsFeature)
export class ListClubOrgEventsHandler
    implements IFeatureHandler<ListClubOrgEventsFeature, ListClubOrgEventsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListClubOrgEventsFeature) {
        const now = new Date()
        const staff = await isClubStaff(this.prisma, f.workspaceId, f.userId, f.roleName)
        const rows = await this.prisma.organizationEvent.findMany({
            where: {
                AND: [
                    clubOrgEventsWhere(f.workspaceId, staff, now),
                    { OR: [{ startAt: { gte: now } }, { endAt: { gte: now } }] },
                ],
            },
            select: CLUB_ORG_EVENT_SELECT,
            orderBy: { startAt: 'asc' },
            take: 100,
        })
        const ids = rows.map((r) => r.id)
        const [counts, mine] = await Promise.all([
            bookedCounts(this.prisma, ids),
            this.prisma.organizationEventRegistration.findMany({
                where: { eventId: { in: ids }, userId: f.userId },
                select: { id: true, eventId: true, status: true },
            }),
        ])
        const mineByEvent = new Map(mine.map((r) => [r.eventId, r]))
        return {
            data: rows.map((r) =>
                serializeClubOrgEvent(r, counts.get(r.id) ?? 0, mineByEvent.get(r.id) ?? null, now),
            ),
        }
    }
}
