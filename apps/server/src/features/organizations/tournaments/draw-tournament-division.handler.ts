import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadBracketView, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { drawDivision } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    DrawTournamentDivisionFeature,
    DrawTournamentDivisionFeatureResponse,
} from './matches.feature'
import { serializeTournamentBracket } from './schemas'

// «Жеребьёвка» / «Пережеребить» (refused once a result is in).
@Feature(DrawTournamentDivisionFeature)
export class DrawTournamentDivisionHandler
    implements
        IFeatureHandler<DrawTournamentDivisionFeature, DrawTournamentDivisionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: DrawTournamentDivisionFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const bracketBefore = await loadBracketView(this.prisma, f.organizationId, t.id, f.divisionId)
        const { drawNo } = await drawDivision(this.prisma, {
            tournamentId: t.id,
            divisionId: bracketBefore.division.id,
            now: new Date(),
        })
        await this.audit.record({
            action: 'tournament.draw',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                tournamentId: t.id,
                divisionId: bracketBefore.division.id,
                divisionName: bracketBefore.division.name,
                drawNo,
            },
        })
        return serializeTournamentBracket(
            await loadBracketView(this.prisma, f.organizationId, t.id, f.divisionId),
        )
    }
}
