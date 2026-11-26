import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { autoAssignMats } from '../../../domains/tournaments/schedule'
import { TournamentPublishedError } from '../../../domains/tournaments/tournament-errors'
import { loadDivisionViews, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { AssignTournamentMatsFeature, AssignTournamentMatsFeatureResponse } from './divisions.feature'
import { serializeTournamentDivision } from './schemas'

// «Распределить по коврам»: divisions without results spread over the mats.
@Feature(AssignTournamentMatsFeature)
export class AssignTournamentMatsHandler
    implements IFeatureHandler<AssignTournamentMatsFeature, AssignTournamentMatsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: AssignTournamentMatsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        if (t.status === 'FINISHED') throw new TournamentPublishedError()
        const views = await loadDivisionViews(this.prisma, t.id)
        const plan = autoAssignMats(views, t.matCount)
        await this.prisma.$transaction(
            plan.map((p) =>
                this.prisma.tournamentDivision.update({
                    where: { id: p.id },
                    data: { mat: p.mat, matOrder: p.matOrder },
                    select: { id: true },
                }),
            ),
        )
        await this.audit.record({
            action: 'tournament.matsAssign',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { tournamentId: t.id, count: plan.length, matCount: t.matCount },
        })
        const after = await loadDivisionViews(this.prisma, t.id)
        return { data: after.map(serializeTournamentDivision) }
    }
}
