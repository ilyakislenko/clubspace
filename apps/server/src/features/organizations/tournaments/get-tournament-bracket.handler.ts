import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadBracketView, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { GetTournamentBracketFeature, GetTournamentBracketFeatureResponse } from './matches.feature'
import { serializeTournamentBracket } from './schemas'

@Feature(GetTournamentBracketFeature)
export class GetTournamentBracketHandler
    implements IFeatureHandler<GetTournamentBracketFeature, GetTournamentBracketFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: GetTournamentBracketFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        return serializeTournamentBracket(
            await loadBracketView(this.prisma, f.organizationId, t.id, f.divisionId),
        )
    }
}
