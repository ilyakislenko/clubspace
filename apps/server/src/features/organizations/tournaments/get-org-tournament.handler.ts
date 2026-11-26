import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { tournamentResponse } from './tournament-response'
import { GetOrgTournamentFeature, GetOrgTournamentFeatureResponse } from './tournament.feature'

@Feature(GetOrgTournamentFeature)
export class GetOrgTournamentHandler
    implements IFeatureHandler<GetOrgTournamentFeature, GetOrgTournamentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: GetOrgTournamentFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        return tournamentResponse(this.prisma, t)
    }
}
