import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { bookedCounts } from '../../../domains/organizations/org-events'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    ListOrgEventsFeature,
    ListOrgEventsFeatureResponse,
} from './list-org-events.feature'
import { ORG_EVENT_INCLUDE, serializeOrgEvent } from './schemas'

const DAY_MS = 24 * 60 * 60_000

@Feature(ListOrgEventsFeature)
export class ListOrgEventsHandler
    implements IFeatureHandler<ListOrgEventsFeature, ListOrgEventsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: ListOrgEventsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        // «Upcoming» keeps an event that started within the last day (a
        // weekend tournament stays listed while it runs).
        const since = new Date(Date.now() - DAY_MS)
        const rows = await this.prisma.organizationEvent.findMany({
            where: {
                organizationId: f.organizationId,
                ...(f.payload.includePast
                    ? {}
                    : { OR: [{ startAt: { gte: since } }, { endAt: { gte: since } }] }),
            },
            include: ORG_EVENT_INCLUDE,
            orderBy: [{ startAt: 'asc' }],
        })
        const counts = await bookedCounts(this.prisma, rows.map((r) => r.id))
        return { data: rows.map((r) => serializeOrgEvent(r, counts.get(r.id) ?? 0)) }
    }
}
