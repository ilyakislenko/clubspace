import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgAdmin, OrgRbacService } from '../../../domains/organizations/org-access'
import { TournamentPublishedError } from '../../../domains/tournaments/tournament-errors'
import { loadOrgTournament, TOURNAMENT_SELECT } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { claimUnchanged } from '../../../shared/utils/optimistic-concurrency'
import { tournamentResponse } from './tournament-response'
import {
    UpdateOrgTournamentFeature,
    UpdateOrgTournamentFeatureResponse,
} from './tournament.feature'

// «Ковров: N». Fewer mats unassign the divisions of the dropped ones («Ковёр
// не назначен»), results stay.
@Feature(UpdateOrgTournamentFeature)
export class UpdateOrgTournamentHandler
    implements IFeatureHandler<UpdateOrgTournamentFeature, UpdateOrgTournamentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdateOrgTournamentFeature) {
        await assertOrgAdmin(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const current = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        if (current.status === 'FINISHED') throw new TournamentPublishedError()
        const row = await this.prisma.$transaction(async (tx) => {
            await claimUnchanged(f.payload.expectedUpdatedAt, (expected) =>
                tx.tournament.updateMany({
                    where: { id: current.id, updatedAt: expected },
                    data: { updatedAt: new Date() },
                }),
            )
            await tx.tournamentDivision.updateMany({
                where: { tournamentId: current.id, mat: { gt: f.payload.matCount } },
                data: { mat: null, matOrder: null },
            })
            return tx.tournament.update({
                where: { id: current.id },
                data: { matCount: f.payload.matCount },
                select: TOURNAMENT_SELECT,
            })
        })
        await this.audit.record({
            action: 'tournament.update',
            targetType: 'tournament',
            targetId: row.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { tournamentId: row.id, eventId: row.eventId, matCount: row.matCount },
        })
        return tournamentResponse(this.prisma, row)
    }
}
