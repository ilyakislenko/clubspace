import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadDivisionViews, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    ListTournamentDivisionsFeature,
    ListTournamentDivisionsFeatureResponse,
} from './divisions.feature'
import { serializeTournamentDivision } from './schemas'

@Feature(ListTournamentDivisionsFeature)
export class ListTournamentDivisionsHandler
    implements
        IFeatureHandler<ListTournamentDivisionsFeature, ListTournamentDivisionsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: ListTournamentDivisionsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const views = await loadDivisionViews(this.prisma, t.id)
        return { data: views.map(serializeTournamentDivision) }
    }
}
