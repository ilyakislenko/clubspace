import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { loadOrgEventRegistrations } from '../../../domains/organizations/org-events'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    ListOrgEventRegistrationsFeature,
    ListOrgEventRegistrationsFeatureResponse,
} from './list-org-event-registrations.feature'

@Feature(ListOrgEventRegistrationsFeature)
export class ListOrgEventRegistrationsHandler
    implements
        IFeatureHandler<
            ListOrgEventRegistrationsFeature,
            ListOrgEventRegistrationsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: ListOrgEventRegistrationsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const event = await this.prisma.organizationEvent.findFirst({
            where: { id: f.eventId, organizationId: f.organizationId },
            select: { id: true },
        })
        if (!event) throw new NotFoundError({ message: 'Событие не найдено' })
        const { rows, hiddenCount } = await loadOrgEventRegistrations(
            this.prisma,
            f.organizationId,
            event.id,
        )
        return {
            data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
            hiddenCount,
        }
    }
}
