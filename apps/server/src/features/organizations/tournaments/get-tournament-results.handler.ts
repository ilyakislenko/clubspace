import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadOrgTournament, loadPodiums } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { GetTournamentResultsFeature, GetTournamentResultsFeatureResponse } from './matches.feature'

// «Итоги»: podiums per division (unfinished ones read «идёт»).
@Feature(GetTournamentResultsFeature)
export class GetTournamentResultsHandler
    implements IFeatureHandler<GetTournamentResultsFeature, GetTournamentResultsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: GetTournamentResultsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const podiums = await loadPodiums(this.prisma, f.organizationId, t.id)
        return {
            status: t.status,
            resultsPublishedAt: t.resultsPublishedAt?.toISOString() ?? null,
            divisions: podiums.map(({ division, podium }) => ({
                divisionId: division.id,
                name: division.name,
                drawn: division.drawnAt !== null,
                finished: division.finishedAt !== null,
                podium: podium.map((e) => ({
                    place: e.place!,
                    entryId: e.id,
                    hidden: !e.visible,
                    personName: e.visible ? e.personName : null,
                    clubName: e.visible ? e.clubName : null,
                })),
            })),
        }
    }
}
