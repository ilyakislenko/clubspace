import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgAdmin, OrgRbacService } from '../../../domains/organizations/org-access'
import { TOURNAMENT_SELECT } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { tournamentResponse } from './tournament-response'
import {
    CreateOrgTournamentFeature,
    CreateOrgTournamentFeatureResponse,
} from './tournament.feature'

// «Провести турнир в ClubSpace» on a COMPETITION event: one per event; a
// second call returns the existing one (create + P2002 → find).
@Feature(CreateOrgTournamentFeature)
export class CreateOrgTournamentHandler
    implements IFeatureHandler<CreateOrgTournamentFeature, CreateOrgTournamentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateOrgTournamentFeature) {
        await assertOrgAdmin(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const event = await this.prisma.organizationEvent.findFirst({
            where: { id: f.eventId, organizationId: f.organizationId },
            select: { id: true, kind: true },
        })
        if (!event) throw new NotFoundError({ message: 'Событие не найдено' })
        if (event.kind !== 'COMPETITION') {
            throw new BadRequestError({ message: 'Турнир проводится только на соревновании' })
        }
        let created = true
        let row
        try {
            row = await this.prisma.tournament.create({
                data: {
                    organizationId: f.organizationId,
                    eventId: event.id,
                    matCount: f.payload.matCount ?? 1,
                    createdById: f.invokerUserId,
                },
                select: TOURNAMENT_SELECT,
            })
        } catch (e) {
            if ((e as { code?: string }).code !== 'P2002') throw e
            created = false
            row = await this.prisma.tournament.findUniqueOrThrow({
                where: { eventId: event.id },
                select: TOURNAMENT_SELECT,
            })
        }
        if (created) {
            await this.audit.record({
                action: 'tournament.create',
                targetType: 'tournament',
                targetId: row.id,
                organizationId: f.organizationId,
                actorId: f.invokerUserId,
                metadata: { tournamentId: row.id, eventId: event.id, matCount: row.matCount },
            })
        }
        return tournamentResponse(this.prisma, row)
    }
}
