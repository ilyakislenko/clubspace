import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadPodiums } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { isClubStaff } from '../events/club-org-events'
import { loadClubTournament } from './club-tournament-access'
import {
    GetClubTournamentResultsFeature,
    GetClubTournamentResultsFeatureResponse,
} from './club-tournaments.feature'
import { serializeClubPerson } from './schemas'

// «Итоги турнира» once published: podiums per division, own club marked.
@Feature(GetClubTournamentResultsFeature)
export class GetClubTournamentResultsHandler
    implements
        IFeatureHandler<GetClubTournamentResultsFeature, GetClubTournamentResultsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetClubTournamentResultsFeature) {
        const staff = await isClubStaff(this.prisma, f.workspaceId, f.invokerUserId, f.roleName)
        const { tournament: t } = await loadClubTournament(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            staff,
        })
        if (t.status !== 'FINISHED' || !t.resultsPublishedAt) {
            throw new NotFoundError({ message: 'Итоги ещё не опубликованы' })
        }
        const viewer = { userId: f.invokerUserId, workspaceId: f.workspaceId, staff }
        const podiums = await loadPodiums(this.prisma, t.organizationId, t.id)
        return {
            resultsPublishedAt: t.resultsPublishedAt.toISOString(),
            divisions: podiums
                .filter((p) => p.podium.length > 0)
                .map(({ division, podium }) => ({
                    divisionId: division.id,
                    name: division.name,
                    podium: podium.map((e) => ({ ...serializeClubPerson(e, viewer), place: e.place! })),
                })),
        }
    }
}
