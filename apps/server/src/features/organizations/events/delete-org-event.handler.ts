import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { TournamentStartedError } from '../../../domains/tournaments/tournament-errors'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    DeleteOrgEventFeature,
    DeleteOrgEventFeatureResponse,
} from './delete-org-event.feature'

// Registrations and a tournament still in setup or weigh-in go with the
// event (cascade); a running or finished tournament keeps it (results).
@Feature(DeleteOrgEventFeature)
export class DeleteOrgEventHandler
    implements IFeatureHandler<DeleteOrgEventFeature, DeleteOrgEventFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: DeleteOrgEventFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const event = await this.prisma.organizationEvent.findFirst({
            where: { id: f.eventId, organizationId: f.organizationId },
            select: { id: true, title: true, tournament: { select: { status: true } } },
        })
        if (!event) throw new NotFoundError({ message: 'Событие не найдено' })
        const started = event.tournament?.status
        if (started === 'RUNNING' || started === 'FINISHED') throw new TournamentStartedError()
        await this.prisma.organizationEvent.delete({ where: { id: event.id } })
        await this.audit.record({
            action: 'org.eventDelete',
            targetType: 'organizationEvent',
            targetId: event.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { title: event.title },
        })
        return { status: 'deleted' as const }
    }
}
