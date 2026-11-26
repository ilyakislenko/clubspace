import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import {
    entryFits,
    filterEntryViews,
    loadDivisionCriteria,
    loadEntryViews,
    loadOrgTournament,
} from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    ListTournamentEntriesFeature,
    ListTournamentEntriesFeatureResponse,
} from './entries.feature'
import { serializeTournamentEntryRow } from './schemas'

// «Участники»: search first, one filter. Visible people by surname; hidden
// ones («Участник скрыт») last and never found by a search.
@Feature(ListTournamentEntriesFeature)
export class ListTournamentEntriesHandler
    implements IFeatureHandler<ListTournamentEntriesFeature, ListTournamentEntriesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: ListTournamentEntriesFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const [entries, divisions] = await Promise.all([
            loadEntryViews(this.prisma, f.organizationId, { tournamentId: t.id }),
            loadDivisionCriteria(this.prisma, t.id),
        ])
        const byId = new Map(divisions.map((d) => [d.id, d]))
        const filtered = filterEntryViews(entries, byId, f.payload)
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 50
        const page = filtered.slice((curPage - 1) * perPage, curPage * perPage)
        return {
            data: page.map((e) => {
                const d = e.divisionId ? byId.get(e.divisionId) : undefined
                return serializeTournamentEntryRow(e, d, entryFits(e, d))
            }),
            total: filtered.length,
            curPage,
            perPage,
        }
    }
}
