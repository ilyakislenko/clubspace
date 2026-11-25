import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { bookedCounts } from '../../../domains/organizations/org-events'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { GetOrgEventFeature, GetOrgEventFeatureResponse } from './get-org-event.feature'
import { ORG_EVENT_INCLUDE, serializeOrgEvent } from './schemas'

@Feature(GetOrgEventFeature)
export class GetOrgEventHandler
    implements IFeatureHandler<GetOrgEventFeature, GetOrgEventFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: GetOrgEventFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const row = await this.prisma.organizationEvent.findFirst({
            where: { id: f.eventId, organizationId: f.organizationId },
            include: ORG_EVENT_INCLUDE,
        })
        if (!row) throw new NotFoundError({ message: 'Событие не найдено' })
        const counts = await bookedCounts(this.prisma, [row.id])
        return serializeOrgEvent(row, counts.get(row.id) ?? 0)
    }
}
